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

const zeig = async (n) => {
  const buf = await (await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(n)}?alt=media`, { headers: h })).arrayBuffer();
  const t = new TextDecoder("utf-16le").decode(buf).split(/\r?\n/).filter((l) => l.trim());
  console.log(`\n== ${n} (${t.length - 1} Zeilen)\n${t[0]}\n...\n${t.slice(-3).join("\n")}`);
};
for (const n of namen.filter((n) => /mahjongroyale/.test(n) && /20260[9]|202610/.test(n))) await zeig(n);
for (const n of namen.filter((n) => /doppeldeutsch/.test(n) && /202609|202610/.test(n) && /overview/.test(n))) await zeig(n);
console.log("\nWeltgeschichte-Dateien:", namen.filter((n) => /weltgeschichte/.test(n)).length);
