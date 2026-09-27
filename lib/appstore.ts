import { gunzipSync } from "zlib";
import { importPKCS8, SignJWT } from "jose";

// ---- Apple App Store Connect: Downloads aus Sales-Reports ----
// Wir holen Sales-Summary-Reports (jaehrlich fuer abgeschlossene Jahre,
// monatlich fuers laufende Jahr, taeglich fuer den laufenden Monat) und
// summieren die "Units" der Erst-Downloads pro App (Apple-Identifier).
// Es kommen nur aggregierte Zahlen zurueck, keine personenbezogenen Daten.

const API = "https://api.appstoreconnect.apple.com/v1/salesReports";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 Stunden

type AppleConfig = {
  issuerId: string;
  keyId: string;
  privateKey: string; // Inhalt der .p8-Datei
  vendorNumber: string;
  startYear: number;
};

function readConfig(): AppleConfig | null {
  const issuerId = process.env.APPSTORE_ISSUER_ID;
  const keyId = process.env.APPSTORE_KEY_ID;
  const rawKey = process.env.APPSTORE_PRIVATE_KEY;
  const vendorNumber = process.env.APPSTORE_VENDOR_NUMBER;
  if (!issuerId || !keyId || !rawKey || !vendorNumber) return null;
  return {
    issuerId,
    keyId,
    // In Env-Variablen stehen Zeilenumbrueche oft als "\n":
    privateKey: rawKey.replace(/\\n/g, "\n"),
    vendorNumber,
    startYear: Number(process.env.APPSTORE_START_YEAR) || new Date().getFullYear() - 2,
  };
}

async function makeJwt(cfg: AppleConfig): Promise<string> {
  const key = await importPKCS8(cfg.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })
    .setIssuer(cfg.issuerId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .setAudience("appstoreconnect-v1")
    .sign(key);
}

type Frequency = "YEARLY" | "MONTHLY" | "DAILY";

// Zaehlt als "Download" nur Erst-Installationen (Product Type beginnt mit
// "1", z.B. 1, 1F, 1T, 1E ... bzw. "F1" fuer Mac). Updates (7*) und
// In-App-Kaeufe (3*, IA*) werden ignoriert.
function isDownloadType(pt: string): boolean {
  const t = pt.trim().toUpperCase();
  return t.startsWith("1") || t === "F1";
}

// Ein Report parsen und Units pro Apple-Identifier aufsummieren. Nebenbei
// den App-Titel je Apple-ID merken: so koennen auch Apps angezeigt werden,
// die (noch) nicht in lib/apps.ts stehen.
function sumReport(
  tsv: string,
  into: Map<string, number>,
  titles: Map<string, string>,
): void {
  const lines = tsv.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) return;
  const headers = lines[0].split("\t");
  const iUnits = headers.indexOf("Units");
  const iType = headers.indexOf("Product Type Identifier");
  const iId = headers.indexOf("Apple Identifier");
  const iTitle = headers.indexOf("Title");
  if (iUnits < 0 || iType < 0 || iId < 0) return;
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split("\t");
    if (!isDownloadType(c[iType] ?? "")) continue;
    const units = Number(c[iUnits]);
    if (!Number.isFinite(units)) continue;
    const id = (c[iId] ?? "").trim();
    if (!id) continue;
    into.set(id, (into.get(id) ?? 0) + units);
    if (iTitle >= 0) {
      const title = (c[iTitle] ?? "").trim();
      if (title && !titles.has(id)) titles.set(id, title);
    }
  }
}

// Einen einzelnen Report holen. 404 = fuer dieses Datum gibt es (noch)
// keine Daten -> null (kein Fehler).
async function fetchReport(
  cfg: AppleConfig,
  jwt: string,
  frequency: Frequency,
  reportDate: string,
): Promise<string | null> {
  const url =
    `${API}?filter[frequency]=${frequency}` +
    `&filter[reportType]=SALES&filter[reportSubType]=SUMMARY` +
    `&filter[vendorNumber]=${encodeURIComponent(cfg.vendorNumber)}` +
    `&filter[reportDate]=${reportDate}&filter[version]=1_0`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Apple ${frequency} ${reportDate}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return gunzipSync(buf).toString("utf8");
}

// Begrenzte Parallelitaet, damit wir Apples Rate-Limit nicht reizen.
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type AppleResult =
  | {
      status: "ok";
      byAppleId: Map<string, number>;
      titleByAppleId: Map<string, string>;
      fetchedAt: number; // Zeitpunkt der Abfrage (ms)
      partial: boolean; // einzelne Berichte fehlten -> Summe evtl. zu niedrig
    }
  | { status: "not-configured" }
  | { status: "error"; detail: string };

let cache: { ts: number; result: AppleResult } | null = null;

async function computeAppleDownloads(): Promise<AppleResult> {
  const cfg = readConfig();
  if (!cfg) return { status: "not-configured" };

  try {
    const jwt = await makeJwt(cfg);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const day = now.getDate();

    // Liste aller anzufragenden Reports zusammenstellen.
    const jobs: { frequency: Frequency; date: string }[] = [];
    for (let y = cfg.startYear; y < year; y++)
      jobs.push({ frequency: "YEARLY", date: String(y) });
    for (let m = 1; m < month; m++)
      jobs.push({ frequency: "MONTHLY", date: `${year}-${pad(m)}` });
    // Apple-Daten haengen ~1 Tag hinterher -> letzter Tag heute-1.
    for (let d = 1; d < day; d++)
      jobs.push({ frequency: "DAILY", date: `${year}-${pad(month)}-${pad(d)}` });

    const totals = new Map<string, number>();
    const titles = new Map<string, string>();
    let firstError: string | null = null;
    await mapLimit(jobs, 6, async (job) => {
      try {
        const tsv = await fetchReport(cfg, jwt, job.frequency, job.date);
        if (tsv) sumReport(tsv, totals, titles);
      } catch (e) {
        if (!firstError)
          firstError = e instanceof Error ? e.message : "Fehler";
      }
    });

    if (totals.size === 0 && firstError)
      return { status: "error", detail: firstError };
    return {
      status: "ok",
      byAppleId: totals,
      titleByAppleId: titles,
      fetchedAt: Date.now(),
      partial: firstError !== null,
    };
  } catch (e) {
    return {
      status: "error",
      detail: e instanceof Error ? e.message : "Fehler",
    };
  }
}

export async function getAppleDownloads(): Promise<AppleResult> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.ts < CACHE_TTL_MS) return cache.result;
  const result = await computeAppleDownloads();
  // Nur vollstaendige Ergebnisse cachen: Fehler und Teilergebnisse (einzelne
  // Berichte fehlten) nicht 6h festhalten, sondern beim naechsten Aufruf neu holen.
  if (result.status === "not-configured" || (result.status === "ok" && !result.partial))
    cache = { ts: nowMs, result };
  return result;
}
