import { gunzipSync } from "zlib";

import { APPS } from "@/lib/apps";
import { AppleConfig, makeJwt, readConfig } from "@/lib/appstore";

// ---- Apple App Store Connect: Analytics Reports ----
// Die Sales-Reports (lib/appstore.ts) kennen nur Erst-Downloads. Aktuelle
// Installationen stehen in der Analytics Reports API - einer eigenen Kette:
//
//   1. analyticsReportRequests  je App einmalig anfordern (Admin-Rolle noetig)
//   2. .../reports              die Berichte der Kategorie APP_USAGE
//   3. .../instances            je Bericht eine Instanz pro Granularitaet/Tag
//   4. .../segments             Download-URLs der eigentlichen Daten (TSV)
//
// Apple braucht nach der ersten Anforderung 24-48 h bis zum ersten Bericht
// und weist Nutzungsmetriken erst ab fuenf aktiven Geraeten aus. Solange
// nichts zurueckkommt, bleibt die iOS-Zelle im Dashboard auf "einrichten".

const API = "https://api.appstoreconnect.apple.com/v1";

// ---- kleine HTTP-Helfer ----

type JsonApi<A> = {
  data?: { id: string; type: string; attributes?: A }[];
  links?: { next?: string };
  errors?: { title?: string; detail?: string; status?: string }[];
};

type Seite<A> = { data: { id: string; attributes?: A }[]; next?: string } | { fehler: string };

// pfad darf auch eine volle URL sein (links.next der Vorseite).
async function get<A>(
  jwt: string,
  pfad: string,
): Promise<Seite<A>> {
  const res = await fetch(pfad.startsWith("https://") ? pfad : `${API}${pfad}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // Apple packt den Grund in errors[].detail - der ist die eigentliche
    // Information (fehlende Rolle, noch keine Anforderung, ...).
    let grund = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as JsonApi<unknown>;
      const e = j.errors?.[0];
      if (e) grund = `${grund}: ${e.title ?? ""} ${e.detail ?? ""}`.trim();
    } catch {
      grund = `${grund}: ${text.slice(0, 200)}`;
    }
    return { fehler: grund };
  }
  try {
    const j = JSON.parse(text) as JsonApi<A>;
    return { data: j.data ?? [], next: j.links?.next };
  } catch {
    return { fehler: "Antwort war kein JSON" };
  }
}

// ---- Typen der einzelnen Stufen ----

export type BerichtsAnfrage = {
  id: string;
  accessType: string;
  stoppedDueToInactivity: boolean;
};

export type Bericht = { id: string; name: string; category: string };

export type Instanz = {
  id: string;
  granularity: string;
  processingDate: string;
};

export type SegmentInfo = {
  id: string;
  url?: string;
  sizeInBytes?: number;
};

// ---- Stufe 1: Anforderungen ----

export async function leseAnfragen(
  jwt: string,
  appleAppId: string,
): Promise<BerichtsAnfrage[] | { fehler: string }> {
  const r = await get<{
    accessType?: string;
    stoppedDueToInactivity?: boolean;
  }>(
    jwt,
    `/apps/${encodeURIComponent(appleAppId)}/analyticsReportRequests` +
      `?fields[analyticsReportRequests]=accessType,stoppedDueToInactivity`,
  );
  if ("fehler" in r) return r;
  return r.data.map((d) => ({
    id: d.id,
    accessType: d.attributes?.accessType ?? "?",
    stoppedDueToInactivity: d.attributes?.stoppedDueToInactivity ?? false,
  }));
}

// Einmalige Anforderung eines Berichtstyps. Das ist ein SCHREIBZUGRIFF auf
// das App-Store-Connect-Konto und braucht eine Admin-Rolle des Schluessels.
// Wird nur ueber /api/apple-report-request ausgeloest, nie beim Seitenaufruf.
export async function fordereAn(
  jwt: string,
  appleAppId: string,
  accessType: "ONGOING" | "ONE_TIME_SNAPSHOT",
): Promise<{ id: string } | { fehler: string }> {
  const res = await fetch(`${API}/analyticsReportRequests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType },
        relationships: {
          app: { data: { type: "apps", id: appleAppId } },
        },
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let grund = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as JsonApi<unknown>;
      const e = j.errors?.[0];
      if (e) grund = `${grund}: ${e.title ?? ""} ${e.detail ?? ""}`.trim();
    } catch {
      grund = `${grund}: ${text.slice(0, 200)}`;
    }
    return { fehler: grund };
  }
  try {
    const j = JSON.parse(text) as { data?: { id?: string } };
    return { id: j.data?.id ?? "?" };
  } catch {
    return { fehler: "Antwort war kein JSON" };
  }
}

// ---- Stufe 2-4 ----

export async function leseBerichte(
  jwt: string,
  anfrageId: string,
): Promise<Bericht[] | { fehler: string }> {
  const r = await get<{ name?: string; category?: string }>(
    jwt,
    `/analyticsReportRequests/${encodeURIComponent(anfrageId)}/reports` +
      `?fields[analyticsReports]=name,category&limit=200`,
  );
  if ("fehler" in r) return r;
  return r.data.map((d) => ({
    id: d.id,
    name: d.attributes?.name ?? "?",
    category: d.attributes?.category ?? "?",
  }));
}

export async function leseInstanzen(
  jwt: string,
  berichtId: string,
): Promise<Instanz[] | { fehler: string }> {
  // Hoechstens 200 je Seite; ein Snapshot mit der ganzen Historie hat mehr.
  const liste: Instanz[] = [];
  let pfad: string | undefined =
    `/analyticsReports/${encodeURIComponent(berichtId)}/instances` +
    `?filter[granularity]=DAILY` +
    `&fields[analyticsReportInstances]=granularity,processingDate&limit=200`;
  for (let seite = 0; pfad && seite < 10; seite++) {
    const r: Seite<{ granularity?: string; processingDate?: string }> = await get(jwt, pfad);
    if ("fehler" in r) return r;
    for (const d of r.data)
      liste.push({
        id: d.id,
        granularity: d.attributes?.granularity ?? "?",
        processingDate: d.attributes?.processingDate ?? "?",
      });
    pfad = r.next;
  }
  liste.sort((a, b) => a.processingDate.localeCompare(b.processingDate));
  return liste;
}

export async function leseSegmente(
  jwt: string,
  instanzId: string,
): Promise<SegmentInfo[] | { fehler: string }> {
  const r = await get<{ url?: string; sizeInBytes?: number }>(
    jwt,
    `/analyticsReportInstances/${encodeURIComponent(instanzId)}/segments` +
      `?fields[analyticsReportSegments]=url,checksum,sizeInBytes`,
  );
  if ("fehler" in r) return r;
  return r.data.map((d) => ({
    id: d.id,
    url: d.attributes?.url,
    sizeInBytes: d.attributes?.sizeInBytes,
  }));
}

// Segment herunterladen. Die URL ist bereits signiert - kein JWT mitschicken.
// Apple liefert laut Doku .txt.gz; falls doch etwas anderes kommt, sagen wir
// das lieber, als stillschweigend Unsinn zu parsen.
export async function ladeSegment(
  url: string,
): Promise<{ tsv: string } | { fehler: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { fehler: `Download: HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return { tsv: gunzipSync(buf).toString("utf8") };
    } catch (e) {
      return { fehler: `gunzip: ${e instanceof Error ? e.message : "Fehler"}` };
    }
  }
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)
    return { fehler: "ZIP statt gzip - Entpacken noch nicht eingebaut" };
  return { tsv: buf.toString("utf8") };
}

// ---- Auswertung einer TSV ----

export function spaltenVon(tsv: string): string[] {
  const zeile = tsv.split(/\r?\n/).find((l) => l.trim().length > 0);
  return zeile ? zeile.split("\t").map((h) => h.trim()) : [];
}

// Eine Spalte ueber alle Zeilen summieren.
// null = Spalte fehlt oder keine brauchbare Zahl (NICHT "0").
export function summiere(tsv: string, spalte: string): number | null {
  const zeilen = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (zeilen.length < 2) return null;
  const kopf = zeilen[0].split("\t").map((h) => h.trim());
  const i = kopf.indexOf(spalte);
  if (i < 0) return null;
  let summe = 0;
  let gefunden = false;
  for (let r = 1; r < zeilen.length; r++) {
    const roh = (zeilen[r].split("\t")[i] ?? "").trim();
    if (roh === "") continue;
    const wert = Number(roh.replace(/,/g, ""));
    if (!Number.isFinite(wert)) continue;
    summe += wert;
    gefunden = true;
  }
  return gefunden ? summe : null;
}

// ---- Diagnose: die ganze Kette je App durchlaufen ----

export type AppDiagnose = {
  name: string;
  appleAppId: string;
  anfragen: BerichtsAnfrage[];
  berichte: Bericht[];
  instanzen: number;
  neuesteInstanz: string | null;
  segmente: number;
  spalten: string[];
  zeilen: number;
  beispielZeile: string | null;
  fehler?: string;
};

export async function diagnoseApple(): Promise<
  { apps: AppDiagnose[] } | { fehler: string }
> {
  const cfg: AppleConfig | null = readConfig();
  if (!cfg) return { fehler: "APPSTORE_* Umgebungsvariablen fehlen" };
  let jwt: string;
  try {
    jwt = await makeJwt(cfg);
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : "JWT-Fehler" };
  }

  const ziele = APPS.filter((a) => a.appleAppId);
  const apps = await Promise.all(
    ziele.map(async (app): Promise<AppDiagnose> => {
      const leer: AppDiagnose = {
        name: app.name,
        appleAppId: app.appleAppId!,
        anfragen: [],
        berichte: [],
        instanzen: 0,
        neuesteInstanz: null,
        segmente: 0,
        spalten: [],
        zeilen: 0,
        beispielZeile: null,
      };
      const anfragen = await leseAnfragen(jwt, app.appleAppId!);
      if ("fehler" in anfragen) return { ...leer, fehler: anfragen.fehler };
      leer.anfragen = anfragen;
      if (!anfragen.length) return leer;

      // Bevorzugt die laufende Anforderung, sonst die erste.
      const anfrage =
        anfragen.find((a) => a.accessType === "ONGOING") ?? anfragen[0];
      const berichte = await leseBerichte(jwt, anfrage.id);
      if ("fehler" in berichte) return { ...leer, fehler: berichte.fehler };
      leer.berichte = berichte;

      // Der Bericht mit Installationen/Loeschungen, sonst der erste aus
      // APP_USAGE - welcher Name genau passt, zeigt die Seite.
      const bericht =
        berichte.find((b) => /install/i.test(b.name)) ??
        berichte.find((b) => b.category === "APP_USAGE") ??
        berichte[0];
      if (!bericht) return leer;

      const instanzen = await leseInstanzen(jwt, bericht.id);
      if ("fehler" in instanzen) return { ...leer, fehler: instanzen.fehler };
      leer.instanzen = instanzen.length;
      if (!instanzen.length) return leer;
      const neueste = instanzen[instanzen.length - 1];
      leer.neuesteInstanz = `${neueste.processingDate} (${bericht.name})`;

      const segmente = await leseSegmente(jwt, neueste.id);
      if ("fehler" in segmente) return { ...leer, fehler: segmente.fehler };
      leer.segmente = segmente.length;
      const url = segmente.find((s) => s.url)?.url;
      if (!url) return leer;

      const daten = await ladeSegment(url);
      if ("fehler" in daten) return { ...leer, fehler: daten.fehler };
      const zeilen = daten.tsv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      return {
        ...leer,
        spalten: spaltenVon(daten.tsv),
        zeilen: Math.max(zeilen.length - 1, 0),
        beispielZeile: zeilen.length > 1 ? zeilen[zeilen.length - 1] : null,
      };
    }),
  );
  return { apps };
}
