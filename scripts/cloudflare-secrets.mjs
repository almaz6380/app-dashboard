// Überträgt gesetzte GitHub-Secrets als Worker-Secrets zu Cloudflare.
//
//   node scripts/cloudflare-secrets.mjs <ausgabe.json> NAME1 NAME2 ...
//
// Nur Namen mit Wert landen in der Datei - ein leeres GitHub-Secret soll einen
// vorhandenen Wert bei Cloudflare nicht überschreiben. DASHBOARD_SECRET wird
// einmalig erzeugt, wenn es nirgends steht: Er muss nur beständig sein.
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const [ziel, ...namen] = process.argv.slice(2);
const werte = {};
for (const n of namen) if (process.env[n]) werte[n] = process.env[n];

if (!werte.DASHBOARD_SECRET) {
  let vorhanden = [];
  try {
    vorhanden = JSON.parse(execFileSync("npx", ["wrangler", "secret", "list", "--format", "json"], { encoding: "utf8" })).map((s) => s.name);
  } catch { /* Worker neu: noch keine Secrets */ }
  if (!vorhanden.includes("DASHBOARD_SECRET")) {
    werte.DASHBOARD_SECRET = randomBytes(32).toString("hex");
    console.log("DASHBOARD_SECRET neu erzeugt (einmalig).");
  }
}

writeFileSync(ziel, JSON.stringify(werte));
console.log(`Übertrage: ${Object.keys(werte).join(", ") || "(nichts)"}`);
