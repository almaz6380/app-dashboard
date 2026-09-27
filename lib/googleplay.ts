import { importPKCS8, SignJWT } from "jose";

// ---- Google Play: Installationszahlen aus dem Report-Bucket ----
// Google legt Statistik-CSVs in gs://pubsite_prod_rev_<id> ab, u.a.
// stats/installs/installs_<paket>_<JJJJMM>_overview.csv (UTF-16).
// Jede Datei enthaelt eine Zeile pro Tag. Wir summieren "Daily User Installs"
// ueber alle Tage aller Monatsberichte - das Gegenstueck zu Apples
// Erst-Downloads. Es kommen nur aggregierte Zahlen zurueck, keine
// personenbezogenen Daten.
//
// NICHT die Spalte "Total User Installs" nehmen: sie steht zwar in der
// Kopfzeile, ist in diesen Berichten aber durchgehend 0 - auch an Tagen mit
// Installationen und aktiven Geraeten. Genau das liess Android ueberall 0
// anzeigen (geprueft ueber alle Apps und Monate auf /diagnose).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Spalte, die wir als "Download" zaehlen: neue Nutzer pro Tag.
export const INSTALL_COLUMN = "Daily User Installs";

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

// Alle Overview-Dateien eines Pakets, chronologisch (Name enthaelt JJJJMM).
async function allOverviewNames(
  bucket: string,
  pkg: string,
  token: string,
): Promise<string[]> {
  const prefix = `stats/installs/installs_${pkg}_`;
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?prefix=${encodeURIComponent(prefix)}&fields=items(name)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`List ${pkg}: HTTP ${res.status}`);
  const json = (await res.json()) as { items?: { name: string }[] };
  return (json.items ?? [])
    .map((i) => i.name)
    .filter((n) => n.endsWith("_overview.csv"))
    .sort();
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

type GoogleResult =
  | {
      status: "ok";
      byPackage: Map<string, number>;
      fetchedAt: number; // Zeitpunkt der Abfrage (ms)
      partial: boolean; // einzelne Apps/Monate fehlten -> Zahlen evtl. zu niedrig
    }
  | { status: "not-configured" }
  | { status: "error"; detail: string };

let cache: { ts: number; result: GoogleResult } | null = null;

async function compute(packages: string[]): Promise<GoogleResult> {
  const cfg = readConfig();
  if (!cfg) return { status: "not-configured" };
  try {
    const token = await getAccessToken(cfg.sa);
    const byPackage = new Map<string, number>();
    // Apps ohne Zahl mit Begruendung sammeln. Frueher gingen diese Faelle
    // still verloren und wurden im Dashboard als "0" angezeigt.
    const ohneZahl: string[] = [];
    let firstError: string | null = null;
    await Promise.all(
      packages.map(async (pkg) => {
        try {
          const dateien = await allOverviewNames(cfg.bucket, pkg, token);
          if (!dateien.length) {
            ohneZahl.push(`${pkg}: kein Bericht im Bucket`);
            return;
          }
          // Alle Monate laden und die Tageswerte aufsummieren.
          const werte = await Promise.all(
            dateien.map(async (datei) =>
              sumSpalte(await rawCsv(cfg.bucket, datei, token), INSTALL_COLUMN),
            ),
          );
          const brauchbar = werte.filter((w): w is number => w !== null);
          if (!brauchbar.length) {
            ohneZahl.push(
              `${pkg}: ${dateien.length} Bericht(e), keiner mit Spalte "${INSTALL_COLUMN}"`,
            );
            return;
          }
          if (brauchbar.length < werte.length) {
            ohneZahl.push(
              `${pkg}: ${werte.length - brauchbar.length} von ${werte.length} Monaten ohne Spalte "${INSTALL_COLUMN}"`,
            );
          }
          byPackage.set(pkg, brauchbar.reduce((s, n) => s + n, 0));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Fehler";
          ohneZahl.push(`${pkg}: ${msg}`);
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

export async function getGoogleInstalls(packages: string[]): Promise<GoogleResult> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.ts < CACHE_TTL_MS) return cache.result;
  const result = await compute(packages);
  // Teilergebnisse nicht cachen (siehe appstore.ts).
  if (result.status === "not-configured" || (result.status === "ok" && !result.partial))
    cache = { ts: nowMs, result };
  return result;
}

// ---- Diagnose ----
// Zeigt, was wirklich im Bucket liegt: welche Monatsdateien es gibt, wie die
// Spalten heissen und welche Summen jeder Monat ergibt. Nur aggregierte
// Zahlen, keine personenbezogenen Daten. Die Seite dazu liegt hinter dem
// Passwort (proxy.ts schuetzt alles ausser /login).
export type MonatsDiagnose = {
  datei: string;
  tage: number; // Tageszeilen in der Datei
  nutzerInstalls: number | null; // Summe "Daily User Installs" -> das zaehlt
  geraeteInstalls: number | null; // Summe "Daily Device Installs"
  aktivGeraete: number | null; // letzter Wert "Active Device Installs"
  letzteZeile: string | null;
};

export type PaketDiagnose = {
  paket: string;
  dateien: number;
  spalten: string[];
  summe: number | null; // ueber alle geladenen Monate, wie im Dashboard
  monate: MonatsDiagnose[];
  fehler?: string;
};

export async function diagnose(
  packages: string[],
): Promise<{ bucket: string; pakete: PaketDiagnose[] } | { fehler: string }> {
  const cfg = readConfig();
  if (!cfg) return { fehler: "GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_PLAY_BUCKET fehlen" };
  let token: string;
  try {
    token = await getAccessToken(cfg.sa);
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : "Token-Fehler" };
  }

  const pakete = await Promise.all(
    packages.map(async (paket): Promise<PaketDiagnose> => {
      try {
        const alle = await allOverviewNames(cfg.bucket, paket, token);
        // Nur die letzten 6 Monate laden, das reicht zur Beurteilung.
        const letzte = alle.slice(-6);
        let spalten: string[] = [];
        const monate = await Promise.all(
          letzte.map(async (datei): Promise<MonatsDiagnose> => {
            const text = await rawCsv(cfg.bucket, datei, token);
            const zeilen = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
            if (zeilen.length && !spalten.length)
              spalten = zeilen[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
            return {
              datei: datei.replace("stats/installs/", ""),
              tage: Math.max(zeilen.length - 1, 0),
              nutzerInstalls: sumSpalte(text, INSTALL_COLUMN),
              geraeteInstalls: sumSpalte(text, "Daily Device Installs"),
              aktivGeraete: letzterWert(text, "Active Device Installs"),
              letzteZeile: zeilen.length > 1 ? zeilen[zeilen.length - 1] : null,
            };
          }),
        );
        const brauchbar = monate
          .map((m) => m.nutzerInstalls)
          .filter((w): w is number => w !== null);
        return {
          paket,
          dateien: alle.length,
          spalten,
          summe: brauchbar.length ? brauchbar.reduce((s, n) => s + n, 0) : null,
          monate,
        };
      } catch (e) {
        return {
          paket,
          dateien: 0,
          spalten: [],
          summe: null,
          monate: [],
          fehler: e instanceof Error ? e.message : "Fehler",
        };
      }
    }),
  );
  return { bucket: cfg.bucket, pakete };
}
