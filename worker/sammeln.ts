// Zeitgesteuerter Abruf fuer den Cloudflare Worker, in kleinen Schritten.
//
// Warum schrittweise: Cloudflare Workers Free erlaubt 10 ms CPU je Aufruf - auch
// fuer Cron-Laeufe. Die Next.js-Fassung hat bei jedem Seitenaufruf alle Berichte
// neu geholt und entpackt (gemessen 10-28 ms). Hier holt jeder Lauf nur ein paar
// Dateien, legt das Ergebnis je Datei in Workers KV ab und rechnet daraus die
// Uebersicht. Abgeschlossene Monate und Tage aendern sich nie mehr und werden nur
// einmal geholt. Warten auf das Netz zaehlt nicht zur CPU-Zeit, Entpacken schon.
import { importPKCS8, SignJWT } from "jose";
import { APPS, AppDef } from "../lib/apps";
import { readConfig as appleConfig, readAdminConfig, makeJwt, sumReport, AppleConfig } from "../lib/appstore";
import { leseAnfragen, fordereAn, leseBerichte, leseInstanzen, leseSegmente, ladeSegment } from "../lib/appleanalytics";
import { sumSpalte, letzterWert, SPALTE_INSTALLS, SPALTE_DEINSTALLS, SPALTE_AKTIV } from "../lib/googleplay";

// Je Lauf hoechstens so viele Downloads. Eine Play-Monatsdatei hat rund 30 Zeilen,
// ein Apple-Bericht ist gezippt; beides kostet Bruchteile einer Millisekunde, aber
// der erste Lauf fuer einen neuen Store fuer sich allein bleibt so sicher unter 10 ms.
const MAX_PLAY = 8;
const MAX_APPLE = 2;
// Laufender und letzter Monat aendern sich noch (Google liefert 2-3 Tage verspaetet).
const PLAY_AKTUALISIEREN_MS = 3 * 60 * 60 * 1000;
// Ein fehlender Apple-Bericht (404) ist meist nur noch nicht erschienen.
const APPLE_NOCHMAL_MS = 6 * 60 * 60 * 1000;
// Apple Analytics: hoechstens so viele Anfragen je Lauf (Workers Free: 50 je Aufruf).
const MAX_ANALYTIK = 12;
const ANFRAGEN_NOCHMAL_MS = 24 * 60 * 60 * 1000;
const INSTANZEN_NOCHMAL_MS = 6 * 60 * 60 * 1000;

export type Metric = { value: number | null; status: "ok" | "not-configured" | "error"; detail?: string };

export type Zeile = {
  id: string;
  name: string;
  ios: Metric;
  android: Metric;
  mitglieder: Metric;
  neu?: boolean;
};

export type Uebersicht = { zeilen: Zeile[]; stand: number | null; unvollstaendig: boolean; hinweise: string[] };

type PlayDatei = { installs: number | null; deinst: number | null; aktiv: number | null; geholt: number };
type AppleBericht = { units?: Record<string, number>; titel?: Record<string, string>; fehlt?: boolean; geholt: number };

// Apple Analytics, nur fuer die Loeschungen. Kette: Anforderung -> Bericht
// "App Store Installation and Deletion Standard" -> Tagesinstanzen -> Segmente.
export type Analytik = {
  anfragen: Record<string, { ids: string[]; geholt: number; fehler?: string }>; // Apple-ID -> Anforderungen
  berichte: Record<string, { app: string; id: string | null; geholt: number }>; // Anforderung -> Bericht
  instanzen: Record<string, { app: string; ids: string[]; geholt: number }>; // Bericht -> Tagesinstanzen
  erledigt: Record<string, number>; // Instanz -> wann ausgewertet
  loeschungen: Record<string, Record<string, number>>; // Apple-ID -> Datum -> Loeschungen
};

export const leereAnalytik = (): Analytik => ({ anfragen: {}, berichte: {}, instanzen: {}, erledigt: {}, loeschungen: {} });

export type Zustand = {
  play: Record<string, PlayDatei>; // Schluessel: Dateiname im Bucket
  playDateien: string[]; // zuletzt gesehene Liste, chronologisch je Paket
  apple: Record<string, AppleBericht>; // Schluessel: "DAILY:2026-09-28"
  analytik?: Analytik; // fehlt in Zustaenden von vor dem 02.10.2026
  mitglieder: Record<string, Metric>;
  fehler: Record<string, string>;
  lauf: number;
};

export const leererZustand = (): Zustand => ({ play: {}, playDateien: [], apple: {}, analytik: leereAnalytik(), mitglieder: {}, fehler: {}, lauf: 0 });

const DATEINAME = /^stats\/installs\/installs_(.+)_(\d{6})_overview\.csv$/;
const NICHT_EINGERICHTET: Metric = { value: null, status: "not-configured" };
const NICHT_IM_STORE: Metric = { value: null, status: "not-configured", detail: "nicht im Store" };
const KEINE_KONTEN: Metric = { value: null, status: "not-configured", detail: "keine Konten" };

const fehlerText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

// ---- Google Play ------------------------------------------------------------

function playConfig(): { email: string; key: string; bucket: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const bucket = process.env.GOOGLE_PLAY_BUCKET;
  if (!raw || !bucket) return null;
  try {
    const sa = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!sa.client_email || !sa.private_key) return null;
    return { email: sa.client_email, key: sa.private_key.replace(/\\n/g, "\n"), bucket: bucket.replace(/^gs:\/\//, "").replace(/\/.*$/, "").trim() };
  } catch {
    return null;
  }
}

async function googleToken(email: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(pem, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/devstorage.read_only" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google-Token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function playListe(bucket: string, token: string): Promise<string[]> {
  const namen: string[] = [];
  let seite: string | undefined;
  do {
    const url =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o` +
      `?prefix=${encodeURIComponent("stats/installs/installs_")}&fields=items(name),nextPageToken` +
      (seite ? `&pageToken=${encodeURIComponent(seite)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Play-Liste: HTTP ${res.status}`);
    const json = (await res.json()) as { items?: { name: string }[]; nextPageToken?: string };
    for (const it of json.items ?? []) if (DATEINAME.test(it.name)) namen.push(it.name);
    seite = json.nextPageToken;
  } while (seite);
  return namen.sort();
}

async function playDatei(bucket: string, name: string, token: string): Promise<PlayDatei> {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Play ${name}: HTTP ${res.status}`);
  // Google liefert UTF-16LE mit BOM; TextDecoder entfernt das BOM selbst.
  const text = new TextDecoder("utf-16le").decode(await res.arrayBuffer());
  return {
    installs: sumSpalte(text, SPALTE_INSTALLS),
    deinst: sumSpalte(text, SPALTE_DEINSTALLS),
    aktiv: letzterWert(text, SPALTE_AKTIV),
    geholt: Date.now(),
  };
}

const monatSchluessel = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Welche Dateien dieser Lauf holt: erst fehlende (neueste zuerst, sie tragen die
// aktuelle Zahl), dann die noch veraenderlichen der letzten zwei Monate.
export function playAuswahl(dateien: string[], play: Record<string, PlayDatei>, jetzt: number, max = MAX_PLAY): string[] {
  const d = new Date(jetzt);
  const dieser = monatSchluessel(d);
  const letzter = monatSchluessel(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
  const fehlend = dateien.filter((n) => !play[n]).reverse();
  const veraenderlich = dateien
    .filter((n) => play[n] && [dieser, letzter].includes(DATEINAME.exec(n)?.[2] ?? "") && jetzt - play[n].geholt > PLAY_AKTUALISIEREN_MS)
    .sort((a, b) => play[a].geholt - play[b].geholt);
  return [...fehlend, ...veraenderlich].slice(0, max);
}

// Alle Monatsdateien eines Pakets zu den drei Zahlen zusammenfuehren - wie
// fasseZusammen in lib/googleplay.ts, nur aus den gespeicherten Einzelwerten.
export function playJePaket(z: Zustand): Map<string, { installs: number | null; aktiv: number | null; vollstaendig: boolean }> {
  const out = new Map<string, { installs: number | null; aktiv: number | null; vollstaendig: boolean }>();
  for (const name of z.playDateien) {
    const paket = DATEINAME.exec(name)?.[1];
    if (!paket) continue;
    const e = out.get(paket) ?? { installs: null, aktiv: null, vollstaendig: true };
    const datei = z.play[name];
    if (!datei) e.vollstaendig = false;
    else {
      if (datei.installs !== null) e.installs = (e.installs ?? 0) + datei.installs;
      if (datei.aktiv !== null) e.aktiv = datei.aktiv; // chronologisch -> letzter = juengster
    }
    out.set(paket, e);
  }
  return out;
}

// ---- Apple Sales --------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

// Dieselbe Aufteilung wie computeAppleDownloads in lib/appstore.ts: Jahre bis
// letztes Jahr, Monate des laufenden Jahres bis letzten Monat, Tage des laufenden
// Monats bis gestern. Fehlt ein Monatsbericht noch (Anfang des Folgemonats), fuellen
// Tagesberichte die Luecke - sonst fielen diese Tage still aus der Summe.
export function appleAuftraege(startJahr: number, jetzt: number, apple: Record<string, AppleBericht>): string[] {
  const d = new Date(jetzt);
  const jahr = d.getUTCFullYear(), monat = d.getUTCMonth() + 1, tag = d.getUTCDate();
  const out: string[] = [];
  const tageVon = (j: number, m: number, bis: number) => {
    for (let t = 1; t <= bis; t++) out.push(`DAILY:${j}-${pad(m)}-${pad(t)}`);
  };
  for (let j = startJahr; j < jahr; j++) out.push(`YEARLY:${j}`);
  for (let m = 1; m < monat; m++) {
    const k = `MONTHLY:${jahr}-${pad(m)}`;
    out.push(k);
    if (m === monat - 1 && apple[k]?.fehlt) tageVon(jahr, m, new Date(Date.UTC(jahr, m, 0)).getUTCDate());
  }
  tageVon(jahr, monat, tag - 1);
  return out;
}

export function appleAuswahl(auftraege: string[], apple: Record<string, AppleBericht>, jetzt: number, max = MAX_APPLE): string[] {
  const neu = auftraege.filter((k) => !apple[k]).reverse();
  const nochmal = auftraege.filter((k) => apple[k]?.fehlt && jetzt - apple[k].geholt > APPLE_NOCHMAL_MS);
  return [...neu, ...nochmal].slice(0, max);
}

async function appleBericht(cfg: AppleConfig, jwt: string, schluessel: string): Promise<AppleBericht> {
  const [frequenz, datum] = schluessel.split(":");
  const url =
    `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=${frequenz}` +
    `&filter[reportType]=SALES&filter[reportSubType]=SUMMARY` +
    `&filter[vendorNumber]=${encodeURIComponent(cfg.vendorNumber)}` +
    `&filter[reportDate]=${datum}&filter[version]=1_0`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" } });
  if (res.status === 404) return { fehlt: true, geholt: Date.now() };
  if (!res.ok) throw new Error(`Apple ${schluessel}: HTTP ${res.status}`);
  const text = await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  const units = new Map<string, number>(), titel = new Map<string, string>();
  sumReport(text, units, titel);
  return { units: Object.fromEntries(units), titel: Object.fromEntries(titel), geholt: Date.now() };
}

// ---- Apple Analytics: Loeschungen -------------------------------------------------
//
// Apple kennt keine Zahl "aktuell installierte Geraete". Annaeherung (Entscheidung
// vom 02.10.2026): Erst-Downloads aus den Sales-Berichten minus Loeschungen aus der
// Analytics Reports API. Loeschungen meldet Apple nur von Nutzern mit Analyse-
// Freigabe - die Zahl liegt darum eher etwas zu hoch und wird als "ca." gezeigt.

const BERICHT_LOESCHUNGEN = /installation and deletion standard/i;

// Loeschungen je Apple-ID und Datum aus einer Segment-TSV.
export function loeschungenAus(tsv: string, app: string): Record<string, Record<string, number>> {
  const zeilen = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: Record<string, Record<string, number>> = {};
  if (zeilen.length < 2) return out;
  const kopf = zeilen[0].split("\t").map((h) => h.trim());
  const iEvent = kopf.indexOf("Event"), iAnzahl = kopf.indexOf("Counts");
  const iDatum = kopf.indexOf("Date"), iApp = kopf.indexOf("App Apple Identifier");
  if (iEvent < 0 || iAnzahl < 0 || iDatum < 0) throw new Error(`Apple-Loeschungen: Spalten unbekannt (${kopf.slice(0, 8).join(", ")})`);
  for (let r = 1; r < zeilen.length; r++) {
    const f = zeilen[r].split("\t");
    if ((f[iEvent] ?? "").trim().toLowerCase() !== "delete") continue;
    const n = Number((f[iAnzahl] ?? "").trim().replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const id = (iApp >= 0 && f[iApp]?.trim()) || app;
    const datum = (f[iDatum] ?? "").trim();
    (out[id] ??= {})[datum] = (out[id][datum] ?? 0) + n;
  }
  return out;
}

// Laufende Anforderung und Snapshot koennen dieselben Tage liefern. Je Tag den
// groesseren Wert behalten statt zu addieren - sonst zaehlten sie doppelt.
export function loeschungenMerken(a: Analytik, neu: Record<string, Record<string, number>>): void {
  for (const [id, tage] of Object.entries(neu)) {
    const ziel = (a.loeschungen[id] ??= {});
    for (const [datum, n] of Object.entries(tage)) ziel[datum] = Math.max(ziel[datum] ?? 0, n);
  }
}

// Noch nicht ausgewertete Tagesinstanzen einer App.
export function offeneInstanzen(a: Analytik, app: string): string[] {
  return Object.values(a.instanzen).filter((i) => i.app === app).flatMap((i) => i.ids.filter((id) => !a.erledigt[id]));
}

async function analytikSchritt(z: Zustand, cfg: AppleConfig, jetzt: number): Promise<void> {
  const a = (z.analytik ??= leereAnalytik());
  let budget = MAX_ANALYTIK;
  let jwt: string | undefined;
  const token = async () => (jwt ??= await makeJwt(cfg));
  const apps = APPS.filter((x) => x.appleAppId).map((x) => x.appleAppId!);

  // 1. Anforderungen je App (taeglich nachsehen). Fehlt eine, mit dem Admin-
  //    Schluessel anfordern: laufend fuer neue Tage, Snapshot fuer die Historie.
  for (const app of apps) {
    if (budget <= 0) return;
    const alt = a.anfragen[app];
    if (alt && jetzt - alt.geholt < ANFRAGEN_NOCHMAL_MS) continue;
    budget--;
    const liste = await leseAnfragen(await token(), app);
    // Fehler merken und erst morgen wieder versuchen - nicht jeden Lauf.
    if ("fehler" in liste) { a.anfragen[app] = { ids: alt?.ids ?? [], geholt: jetzt, fehler: liste.fehler }; continue; }
    const eintrag: Analytik["anfragen"][string] = { ids: liste.map((x) => x.id), geholt: jetzt };
    a.anfragen[app] = eintrag;
    const fehlend = (["ONGOING", "ONE_TIME_SNAPSHOT"] as const).filter((t) => !liste.some((x) => x.accessType === t));
    if (!fehlend.length) continue;
    const admin = readAdminConfig();
    if (!admin) { if (!liste.length) eintrag.fehler = "noch nicht angefordert (APPSTORE_ADMIN_* fehlt)"; continue; }
    const adminJwt = await makeJwt(admin);
    for (const typ of fehlend) {
      budget--;
      const r = await fordereAn(adminJwt, app, typ);
      if ("fehler" in r) eintrag.fehler = `Anfordern: ${r.fehler}`;
      else eintrag.geholt = 0; // naechster Lauf liest die neue Anforderung
    }
  }

  // 2. Je Anforderung den Bericht mit den Loeschungen suchen. Apple legt ihn erst
  //    nach 1-2 Tagen an - bis dahin alle 6 h nachsehen.
  for (const [app, { ids }] of Object.entries(a.anfragen)) {
    for (const anfrage of ids) {
      if (budget <= 0) return;
      const b = a.berichte[anfrage];
      if (b && (b.id || jetzt - b.geholt < INSTANZEN_NOCHMAL_MS)) continue;
      budget--;
      const berichte = await leseBerichte(await token(), anfrage);
      if ("fehler" in berichte) { z.fehler[`apple-bericht ${app}`] = berichte.fehler; continue; }
      a.berichte[anfrage] = { app, id: berichte.find((x) => BERICHT_LOESCHUNGEN.test(x.name))?.id ?? null, geholt: jetzt };
    }
  }

  // 3. Tagesinstanzen je Bericht (alle 6 h, die laufende Anforderung waechst taeglich).
  for (const { app, id } of Object.values(a.berichte)) {
    if (!id || budget <= 0) continue;
    const alt = a.instanzen[id];
    if (alt && jetzt - alt.geholt < INSTANZEN_NOCHMAL_MS) continue;
    budget--;
    const liste = await leseInstanzen(await token(), id);
    if ("fehler" in liste) { z.fehler[`apple-instanzen ${app}`] = liste.fehler; continue; }
    a.instanzen[id] = { app, ids: liste.map((x) => x.id), geholt: jetzt };
  }

  // 4. Offene Instanzen auswerten. Fertige aendern sich nie mehr.
  for (const app of apps) {
    for (const instanz of offeneInstanzen(a, app)) {
      if (budget < 2) return;
      budget--;
      const segmente = await leseSegmente(await token(), instanz);
      if ("fehler" in segmente) { z.fehler[`apple-segmente ${app}`] = segmente.fehler; continue; }
      let ok = true;
      for (const s of segmente) {
        if (!s.url) continue;
        budget--;
        const daten = await ladeSegment(s.url);
        if ("fehler" in daten) { z.fehler[`apple-segment ${app}`] = daten.fehler; ok = false; break; }
        loeschungenMerken(a, loeschungenAus(daten.tsv, app));
      }
      if (ok) a.erledigt[instanz] = jetzt;
    }
  }
}

// iOS-Zelle: Erst-Downloads minus Loeschungen, sobald beides vollstaendig da ist.
export function iosAktuell(z: Zustand, app: string, startJahr: number, jetzt: number): Metric {
  const auftraege = appleAuftraege(startJahr, jetzt, z.apple);
  if (auftraege.some((k) => !z.apple[k])) return { value: null, status: "not-configured", detail: "lädt" };
  const a = z.analytik ?? leereAnalytik();
  const hatBericht = Object.values(a.instanzen).some((i) => i.app === app && i.ids.length > 0);
  if (!hatBericht) return { value: null, status: "not-configured", detail: "Löschungen fehlen" };
  if (offeneInstanzen(a, app).length) return { value: null, status: "not-configured", detail: "lädt" };
  const downloads = auftraege.reduce((s, k) => s + (z.apple[k]?.units?.[app] ?? 0), 0);
  const weg = Object.values(a.loeschungen[app] ?? {}).reduce((s, n) => s + n, 0);
  return { value: Math.max(0, downloads - weg), status: "ok", detail: "ca." };
}

// ---- Mitglieder (Supabase) ------------------------------------------------------

async function mitglieder(app: AppDef): Promise<Metric> {
  const cfg = app.membersEnv;
  const url = cfg && process.env[cfg.urlVar];
  const key = cfg && process.env[cfg.keyVar];
  if (!cfg || !url || !key) return NICHT_EINGERICHTET;
  try {
    const res = await fetch(`${url}/rest/v1/${cfg.table}?select=id`, {
      method: "HEAD",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
    });
    if (!res.ok) return { value: null, status: "error", detail: `HTTP ${res.status}` };
    const n = Number(res.headers.get("content-range")?.split("/")[1]);
    return Number.isFinite(n) ? { value: n, status: "ok" } : { value: null, status: "error", detail: "keine Anzahl" };
  } catch (e) {
    return { value: null, status: "error", detail: fehlerText(e) };
  }
}

// ---- Ein Lauf --------------------------------------------------------------------

export async function einLauf(z: Zustand, jetzt = Date.now()): Promise<Zustand> {
  z.fehler = {};

  const play = playConfig();
  if (play) {
    try {
      const token = await googleToken(play.email, play.key);
      z.playDateien = await playListe(play.bucket, token);
      const bekannt = new Set(z.playDateien);
      for (const n of Object.keys(z.play)) if (!bekannt.has(n)) delete z.play[n];
      for (const name of playAuswahl(z.playDateien, z.play, jetzt)) {
        try { z.play[name] = await playDatei(play.bucket, name, token); }
        catch (e) { z.fehler[name] = fehlerText(e); }
      }
    } catch (e) {
      z.fehler.play = fehlerText(e);
    }
  } else {
    z.playDateien = [];
    z.play = {};
  }

  const apple = appleConfig();
  if (apple) {
    try {
      const auftraege = appleAuftraege(apple.startYear, jetzt, z.apple);
      const auswahl = appleAuswahl(auftraege, z.apple, jetzt);
      if (auswahl.length) {
        const jwt = await makeJwt(apple);
        for (const k of auswahl) {
          try { z.apple[k] = await appleBericht(apple, jwt, k); }
          catch (e) { z.fehler[k] = fehlerText(e); }
        }
      }
    } catch (e) {
      z.fehler.apple = fehlerText(e);
    }
    try { await analytikSchritt(z, apple, jetzt); }
    catch (e) { z.fehler["apple-analytics"] = fehlerText(e); }
  }

  for (const app of APPS) if (app.hasMembers) z.mitglieder[app.id] = await mitglieder(app);
  z.lauf = jetzt;
  return z;
}

// ---- Uebersicht fuer die Seite ---------------------------------------------------

export function uebersicht(z: Zustand, jetzt = Date.now()): Uebersicht {
  const playKonfiguriert = !!playConfig();
  const appleKonf = appleConfig();
  const jePaket = playJePaket(z);
  const zahl = (n: number | null | undefined): Metric => (n == null ? NICHT_EINGERICHTET : { value: n, status: "ok" });

  const zeilen: Zeile[] = APPS.map((app) => {
    const p = app.androidPackage ? jePaket.get(app.androidPackage) : undefined;
    return {
      id: app.id,
      name: app.name,
      ios: !app.stores.includes("ios") ? NICHT_IM_STORE
        : appleKonf && app.appleAppId ? iosAktuell(z, app.appleAppId, appleKonf.startYear, jetzt) : NICHT_EINGERICHTET,
      android: !app.stores.includes("android") ? NICHT_IM_STORE : playKonfiguriert ? zahl(p?.aktiv) : NICHT_EINGERICHTET,
      mitglieder: app.hasMembers ? (z.mitglieder[app.id] ?? NICHT_EINGERICHTET) : KEINE_KONTEN,
    };
  });

  // Apps, die in einer Quelle auftauchen, aber in lib/apps.ts noch keinen Namen haben.
  const bekanntePakete = new Set(APPS.map((a) => a.androidPackage).filter(Boolean));
  for (const [paket, p] of jePaket) {
    if (bekanntePakete.has(paket)) continue;
    zeilen.push({ id: `play:${paket}`, name: paket, ios: NICHT_IM_STORE, android: zahl(p.aktiv), mitglieder: KEINE_KONTEN, neu: true });
  }
  if (appleKonf) {
    const bekannteApple = new Set(APPS.map((a) => a.appleAppId).filter(Boolean));
    const titel = new Map<string, string>();
    for (const k of appleAuftraege(appleKonf.startYear, jetzt, z.apple)) {
      const b = z.apple[k];
      for (const [id, units] of Object.entries(b?.units ?? {})) {
        if (units > 0 && !bekannteApple.has(id) && !titel.has(id)) titel.set(id, b?.titel?.[id] ?? `Apple-ID ${id}`);
      }
    }
    for (const [id, name] of titel) {
      zeilen.push({ id: `apple:${id}`, name, ios: NICHT_EINGERICHTET, android: NICHT_EINGERICHTET, mitglieder: KEINE_KONTEN, neu: true });
    }
  }

  // Apple-Analytics-Probleme bleiben stehen, bis sie behoben sind (z.fehler gilt nur einen Lauf).
  const apfel = Object.entries(z.analytik?.anfragen ?? {}).filter(([, x]) => x.fehler).map(([id, x]) => `Apple-Löschungen ${id}: ${x.fehler}`);
  const unvollstaendig = [...jePaket.values()].some((p) => !p.vollstaendig) || Object.keys(z.fehler).length > 0 || apfel.length > 0;
  const hinweise = [...apfel, ...Object.entries(z.fehler).map(([k, v]) => `${k}: ${v}`)];
  return { zeilen, stand: z.lauf || null, unvollstaendig, hinweise };
}
