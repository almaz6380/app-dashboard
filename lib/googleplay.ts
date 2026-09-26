import { importPKCS8, SignJWT } from "jose";

// ---- Google Play: Installationszahlen aus dem Report-Bucket ----
// Google legt Statistik-CSVs in gs://pubsite_prod_rev_<id> ab, u.a.
// stats/installs/installs_<paket>_<JJJJMM>_overview.csv (UTF-16).
// Wir lesen die jeweils neueste Monatsdatei und nehmen den letzten Wert
// der Spalte "Total User Installs" (kumulierte Gesamt-Installationen).
// Es kommen nur aggregierte Zahlen zurueck, keine personenbezogenen Daten.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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

// Neueste installs_<paket>_<JJJJMM>_overview.csv im Bucket finden.
async function latestOverviewName(
  bucket: string,
  pkg: string,
  token: string,
): Promise<string | null> {
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
  const overviews = (json.items ?? [])
    .map((i) => i.name)
    .filter((n) => n.endsWith("_overview.csv"))
    .sort(); // Namen enthalten JJJJMM -> alphabetisch = chronologisch
  return overviews.length ? overviews[overviews.length - 1] : null;
}

// Kumulierte Gesamt-Installationen aus einer overview.csv lesen.
async function totalInstalls(
  bucket: string,
  name: string,
  token: string,
): Promise<number | null> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/` +
    `${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Get ${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // UTF-16LE mit BOM -> dekodieren und BOM entfernen
  const text = buf.toString("utf16le").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const iTotal = headers.indexOf("Total User Installs");
  if (iTotal < 0) return null;
  // Von hinten die letzte Zeile mit Wert nehmen = aktuellster kumulierter
  // Stand. Leere Zellen (Tag noch nicht befuellt) ueberspringen, sonst wuerde
  // Number("") faelschlich 0 ergeben.
  for (let r = lines.length - 1; r >= 1; r--) {
    const raw = (lines[r].split(",")[iTotal] ?? "").trim().replace(/^"|"$/g, "");
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
      partial: boolean; // einzelne Apps schlugen fehl -> Zahlen evtl. unvollstaendig
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
    let firstError: string | null = null;
    await Promise.all(
      packages.map(async (pkg) => {
        try {
          const name = await latestOverviewName(cfg.bucket, pkg, token);
          if (!name) return; // App (noch) nicht im Play Store -> keine Datei
          const n = await totalInstalls(cfg.bucket, name, token);
          if (n !== null) byPackage.set(pkg, n);
        } catch (e) {
          if (!firstError) firstError = e instanceof Error ? e.message : "Fehler";
        }
      }),
    );
    if (byPackage.size === 0 && firstError)
      return { status: "error", detail: firstError };
    return {
      status: "ok",
      byPackage,
      fetchedAt: Date.now(),
      partial: firstError !== null,
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
