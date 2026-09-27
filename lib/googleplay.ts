import { importPKCS8, SignJWT } from "jose";

// ---- Google Play: Installationszahlen aus dem Report-Bucket ----
// Google legt Statistik-CSVs in gs://pubsite_prod_rev_<id> ab, u.a.
// stats/installs/installs_<paket>_<JJJJMM>_overview.csv (UTF-16).
// Jede Datei enthaelt eine Zeile pro Tag. Wir lesen ALLE Pakete, die im
// Bucket liegen - so erscheint jede neue App automatisch im Dashboard, ohne
// dass jemand lib/apps.ts pflegt. Es kommen nur aggregierte Zahlen zurueck,
// keine personenbezogenen Daten.
//
// NICHT die Spalte "Total User Installs" nehmen: sie steht zwar in der
// Kopfzeile, ist in diesen Berichten aber durchgehend 0 - auch an Tagen mit
// Installationen und aktiven Geraeten. Genau das liess Android ueberall 0
// anzeigen (geprueft ueber alle Apps und Monate auf /diagnose).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Die drei Spalten, aus denen die drei Zahlen im Dashboard entstehen.
export const SPALTE_INSTALLS = "Daily User Installs"; // Summe = Nutzer seit jeher
export const SPALTE_DEINSTALLS = "Daily User Uninstalls"; // Summe = Deinstallationen
export const SPALTE_AKTIV = "Active Device Installs"; // letzter Wert = aktuell

const PREFIX = "stats/installs/installs_";
// stats/installs/installs_<paket>_<JJJJMM>_overview.csv
const DATEINAME = /^stats\/installs\/installs_(.+)_(\d{6})_overview\.csv$/;

type ServiceAccount = { client_email: string; private_key: string };

function readConfig(): { sa: ServiceAccount; bucket: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const bucket = process.env.GOOGLE_PLAY_BUCKET;
  if (!raw || !bucket) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    // "gs://name/" oder "name" -> reiner Bucket-Name
    const clean = bucket.replace(/^gs:\/\//, "").replace(/\/.*$/, "").trim();
    return { sa, bucket: clean };
  } catch {
    return null;
  }
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Token: HTTP ${res.status} ${await res.text()}`.slice(0, 200));
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

// Alle Overview-Dateien im Bucket, gruppiert nach Paket und chronologisch
// sortiert (der Dateiname enthaelt JJJJMM, alphabetisch = chronologisch).
async function alleOverviews(
  bucket: string,
  token: string,
): Promise<Map<string, string[]>> {
  const nachPaket = new Map<string, string[]>();
  let pageToken: string | undefined;
  do {
    const url =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o` +
      `?prefix=${encodeURIComponent(PREFIX)}&fields=items(name),nextPageToken` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`List: HTTP ${res.status}`);
    const json = (await res.json()) as {
      items?: { name: string }[];
      nextPageToken?: string;
    };
    for (const it of json.items ?? []) {
      const m = DATEINAME.exec(it.name);
      if (!m) continue;
      const paket = m[1];
      const liste = nachPaket.get(paket);
      if (liste) liste.push(it.name);
      else nachPaket.set(paket, [it.name]);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  for (const liste of nachPaket.values()) liste.sort();
  return nachPaket;
}

// Rohen CSV-Text einer Datei holen (UTF-16LE mit BOM -> Text).
async function rawCsv(
  bucket: string,
  name: string,
  token: string,
): Promise<string> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/` +
    `${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Get ${name}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer())
    .toString("utf16le")
    .replace(/^﻿/, "");
}

// ---- CSV-Auswertung (rein, ohne Netzzugriff testbar) ----

function zerlege(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const clean = (s: string) => s.trim().replace(/^"|"$/g, "");
  return {
    headers: lines[0].split(",").map(clean),
    rows: lines.slice(1).map((l) => l.split(",").map(clean)),
  };
}

// Eine Spalte ueber alle Tageszeilen summieren.
// null = Spalte fehlt oder keine einzige brauchbare Zahl (NICHT "0 Installs").
export function sumSpalte(text: string, column: string): number | null {
  const t = zerlege(text);
  if (!t) return null;
  const i = t.headers.indexOf(column);
  if (i < 0) return null;
  let summe = 0;
  let gefunden = false;
  for (const row of t.rows) {
    const raw = row[i] ?? "";
    if (raw === "") continue;
    const val = Number(raw);
    if (!Number.isFinite(val)) continue;
    summe += val;
    gefunden = true;
  }
  return gefunden ? summe : null;
}

// Letzter nicht-leerer Wert einer Spalte - fuer Groessen, die schon kumuliert
// sind (z.B. "Active Device Installs" = aktuell installierte Geraete).
export function letzterWert(text: string, column: string): number | null {
  const t = zerlege(text);
  if (!t) return null;
  const i = t.headers.indexOf(column);
  if (i < 0) return null;
  for (let r = t.rows.length - 1; r >= 0; r--) {
    const raw = t.rows[r][i] ?? "";
    if (raw === "") continue;
    const val = Number(raw);
    if (Number.isFinite(val)) return val;
  }
  return null;
}

// Die drei Zahlen einer App.
export type AndroidZahlen = {
  installs: number | null; // Nutzer, die je installiert haben
  aktuell: number | null; // Geraete mit aktueller Installation
  deinstalliert: number | null; // Deinstallationen
};

// Alle Monatsdateien eines Pakets zu den drei Zahlen zusammenfuehren.
// Exportiert, damit die Zusammenfuehrung ohne Netzzugriff testbar ist.
export function fasseZusammen(texte: string[]): AndroidZahlen {
  let installs: number | null = null;
  let deinstalliert: number | null = null;
  let aktuell: number | null = null;
  for (const text of texte) {
    const i = sumSpalte(text, SPALTE_INSTALLS);
    if (i !== null) installs = (installs ?? 0) + i;
    const d = sumSpalte(text, SPALTE_DEINSTALLS);
    if (d !== null) deinstalliert = (deinstalliert ?? 0) + d;
    // Chronologisch sortiert -> der letzte gefundene Wert ist der juengste.
    const a = letzterWert(text, SPALTE_AKTIV);
    if (a !== null) aktuell = a;
  }
  return { installs, aktuell, deinstalliert };
}

type GoogleResult =
  | {
      status: "ok";
      byPackage: Map<string, AndroidZahlen>;
      fetchedAt: number; // Zeitpunkt der Abfrage (ms)
      partial: boolean; // einzelne Apps/Monate fehlten -> Zahlen evtl. zu niedrig
    }
  | { status: "not-configured" }
  | { status: "error"; detail: string };

let cache: { ts: number; result: GoogleResult } | null = null;

async function compute(): Promise<GoogleResult> {
  const cfg = readConfig();
  if (!cfg) return { status: "not-configured" };
  try {
    const token = await getAccessToken(cfg.sa);
    const nachPaket = await alleOverviews(cfg.bucket, token);
    const byPackage = new Map<string, AndroidZahlen>();
    // Apps ohne (vollstaendige) Zahl mit Begruendung sammeln. Frueher gingen
    // diese Faelle still verloren und wurden im Dashboard als "0" angezeigt.
    const ohneZahl: string[] = [];
    let firstError: string | null = null;

    await Promise.all(
      [...nachPaket].map(async ([paket, dateien]) => {
        try {
          const texte = await Promise.all(
            dateien.map((d) => rawCsv(cfg.bucket, d, token)),
          );
          const zahlen = fasseZusammen(texte);
          if (zahlen.installs === null) {
            ohneZahl.push(
              `${paket}: ${dateien.length} Bericht(e), keiner mit Spalte "${SPALTE_INSTALLS}"`,
            );
            return;
          }
          byPackage.set(paket, zahlen);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Fehler";
          ohneZahl.push(`${paket}: ${msg}`);
          if (!firstError) firstError = msg;
        }
      }),
    );

    // Warum eine App keine (vollstaendige) Zahl hat, ist im Dashboard nicht
    // sichtbar -> ins Server-Log, abrufbar mit `vercel logs <deployment>`.
    if (ohneZahl.length)
      console.warn("[googleplay] unvollstaendig:", ohneZahl.join(" | "));
    if (byPackage.size === 0 && firstError)
      return { status: "error", detail: firstError };
    return {
      status: "ok",
      byPackage,
      fetchedAt: Date.now(),
      // Auch ein fehlender Bericht ohne Fehler ist ein Teilergebnis: so wird
      // es nicht 6h gecacht, sondern beim naechsten Aufruf neu versucht.
      partial: ohneZahl.length > 0,
    };
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function getGoogleInstalls(): Promise<GoogleResult> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.ts < CACHE_TTL_MS) return cache.result;
  const result = await compute();
  // Teilergebnisse nicht cachen (siehe appstore.ts).
  if (result.status === "not-configured" || (result.status === "ok" && !result.partial))
    cache = { ts: nowMs, result };
  return result;
}

// ---- Diagnose ----
// Zeigt, was wirklich im Bucket liegt: welche Pakete und Monatsdateien es
// gibt, wie die Spalten heissen und welche Summen jeder Monat ergibt. Nur
// aggregierte Zahlen. Die Seite dazu liegt hinter dem Passwort (proxy.ts
// schuetzt alles ausser /login).
export type MonatsDiagnose = {
  datei: string;
  tage: number; // Tageszeilen in der Datei
  installs: number | null;
  deinstalliert: number | null;
  aktuell: number | null;
  letzteZeile: string | null;
};

export type PaketDiagnose = {
  paket: string;
  dateien: number;
  spalten: string[];
  gesamt: AndroidZahlen;
  monate: MonatsDiagnose[];
  fehler?: string;
};

export async function diagnose(): Promise<
  { bucket: string; pakete: PaketDiagnose[] } | { fehler: string }
> {
  const cfg = readConfig();
  if (!cfg) return { fehler: "GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_PLAY_BUCKET fehlen" };
  let token: string;
  let nachPaket: Map<string, string[]>;
  try {
    token = await getAccessToken(cfg.sa);
    nachPaket = await alleOverviews(cfg.bucket, token);
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : "Zugriffsfehler" };
  }

  const pakete = await Promise.all(
    [...nachPaket].map(async ([paket, alle]): Promise<PaketDiagnose> => {
      try {
        // Nur die letzten 6 Monate laden, das reicht zur Beurteilung.
        const letzte = alle.slice(-6);
        const texte = await Promise.all(
          letzte.map((d) => rawCsv(cfg.bucket, d, token)),
        );
        let spalten: string[] = [];
        const monate = letzte.map((datei, i): MonatsDiagnose => {
          const text = texte[i];
          const zeilen = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (zeilen.length && !spalten.length)
            spalten = zeilen[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
          return {
            datei: datei.replace("stats/installs/", ""),
            tage: Math.max(zeilen.length - 1, 0),
            installs: sumSpalte(text, SPALTE_INSTALLS),
            deinstalliert: sumSpalte(text, SPALTE_DEINSTALLS),
            aktuell: letzterWert(text, SPALTE_AKTIV),
            letzteZeile: zeilen.length > 1 ? zeilen[zeilen.length - 1] : null,
          };
        });
        return {
          paket,
          dateien: alle.length,
          spalten,
          gesamt: fasseZusammen(texte),
          monate,
        };
      } catch (e) {
        return {
          paket,
          dateien: alle.length,
          spalten: [],
          gesamt: { installs: null, aktuell: null, deinstalliert: null },
          monate: [],
          fehler: e instanceof Error ? e.message : "Fehler",
        };
      }
    }),
  );
  pakete.sort((a, b) => a.paket.localeCompare(b.paket));
  return { bucket: cfg.bucket, pakete };
}
