// Diagnose: welche Berichte und Spalten liegen im Play-Bucket? Gibt nur
// Dateinamen, Kopfzeilen und die letzten Zeilen (aggregierte Zahlen) aus.
import { importPKCS8, SignJWT } from "jose";

const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const bucket = process.env.GOOGLE_PLAY_BUCKET.replace(/^gs:\/\//, "").replace(/\/.*$/, "").trim();
const now = Math.floor(Date.now() / 1000);
const key = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/devstorage.read_only" })
  .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(sa.client_email)
  .setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
const tok = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) })).json()).access_token;
const h = { Authorization: `Bearer ${tok}` };

const namen = [];
let seite;
do {
  const r = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=stats/&fields=items(name),nextPageToken${seite ? `&pageToken=${seite}` : ""}`, { headers: h })).json();
  for (const it of r.items ?? []) namen.push(it.name);
  seite = r.nextPageToken;
} while (seite);

// Berichtsarten: Dateiname ohne Paket und Monat
const arten = {};
for (const n of namen) { const a = n.replace(/_[a-z0-9_.]+?_\d{6}/i, "_<paket>_<monat>"); arten[a] = (arten[a] ?? 0) + 1; }
console.log("Berichtsarten:"); for (const [a, c] of Object.entries(arten).sort()) console.log(`  ${a}  (${c})`);

// zeilen = wie viele Zeilen vom Ende (0 = alle).
const zeig = async (n, zeilen = 3) => {
  const buf = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(n)}?alt=media`, { headers: h })).arrayBuffer();
  const t = new TextDecoder("utf-16le").decode(buf).split(/\r?\n/).filter((l) => l.trim());
  console.log(`\n== ${n} (${t.length - 1} Zeilen)\n${t[0]}\n${zeilen ? "...\n" : ""}${(zeilen ? t.slice(-zeilen) : t.slice(1)).join("\n")}`);
};
// Laufender und letzter Monat: je Paket die ganze Uebersicht (Tageszeilen) - zum
// Abgleich mit der Play Console. Dazu die Aufteilungen des groessten Pakets.
const monat = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const jetzt = new Date();
const monate = [monat(new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - 1, 1))), monat(jetzt)];
for (const n of namen.filter((n) => /stats\/installs\/.*_overview\.csv$/.test(n) && monate.some((m) => n.includes(`_${m}_`)))) await zeig(n, 0);
for (const n of namen.filter((n) => /mahjongroyale/.test(n) && n.includes(`_${monate[1]}_`) && !/overview/.test(n))) await zeig(n, 5);
console.log("\nWeltgeschichte-Dateien:", namen.filter((n) => /weltgeschichte/.test(n)).length);
