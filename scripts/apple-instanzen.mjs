// Nur lesen: zeigt je App, welche Instanzen Apples Installations-/Loeschbericht
// hat - ALLE Granularitaeten, nicht nur DAILY wie der Worker. Aendert nichts.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { importPKCS8, SignJWT } from "jose";

const env = process.env;
const keyId = env.APPSTORE_ADMIN_KEY_ID || env.APPSTORE_KEY_ID;
const pem = (env.APPSTORE_ADMIN_PRIVATE_KEY || env.APPSTORE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!env.APPSTORE_ISSUER_ID || !keyId || !pem) { console.log("APPSTORE_* fehlen"); process.exit(0); }
console.log(`Schluessel: ${env.APPSTORE_ADMIN_KEY_ID ? "Admin" : "normal"}`);
const jwt = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
  .setIssuer(env.APPSTORE_ISSUER_ID).setIssuedAt().setExpirationTime("15m").setAudience("appstoreconnect-v1")
  .sign(await importPKCS8(pem, "ES256"));

async function alle(pfad) {
  const out = [];
  let url = `https://api.appstoreconnect.apple.com/v1${pfad}`;
  for (let i = 0; url && i < 20; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status} ${j.errors?.[0]?.detail ?? ""}`);
    out.push(...(j.data ?? []));
    url = j.links?.next;
  }
  return out;
}

// Apple-IDs und Namen aus lib/apps.ts
const quelle = readFileSync("lib/apps.ts", "utf8");
const apps = [...quelle.matchAll(/name: "([^"]+)"[\s\S]*?appleAppId: "(\d+)"/g)].map((m) => ({ name: m[1], id: m[2] }));

for (const app of apps) {
  console.log(`\n== ${app.name} (${app.id})`);
  try {
    const anfragen = await alle(`/apps/${app.id}/analyticsReportRequests?fields[analyticsReportRequests]=accessType,stoppedDueToInactivity`);
    for (const a of anfragen) {
      const berichte = await alle(`/analyticsReportRequests/${a.id}/reports?limit=200&fields[analyticsReports]=name,category`);
      const b = berichte.find((r) => /installation and deletion standard/i.test(r.attributes?.name ?? ""));
      console.log(`  ${a.attributes?.accessType}${a.attributes?.stoppedDueToInactivity ? " (gestoppt)" : ""}: ${berichte.length} Berichte, Installationsbericht ${b ? "ja" : "NEIN"}`);
      if (!b) continue;
      const inst = await alle(`/analyticsReports/${b.id}/instances?limit=200&fields[analyticsReportInstances]=granularity,processingDate`);
      const je = {};
      for (const i of inst) (je[i.attributes?.granularity ?? "?"] ??= []).push(i.attributes?.processingDate ?? "?");
      if (!inst.length) console.log("    keine Instanzen (keine Granularitaet)");
      for (const [g, d] of Object.entries(je)) { d.sort(); console.log(`    ${g}: ${d.length} Instanzen, ${d[0]} bis ${d.at(-1)}`); }
      // Neueste Instanz: Kopfzeile und Summen je Event (nur Zahlen).
      const neu = inst.sort((x, y) => String(x.attributes?.processingDate).localeCompare(String(y.attributes?.processingDate))).at(-1);
      if (!neu) continue;
      const seg = await alle(`/analyticsReportInstances/${neu.id}/segments?fields[analyticsReportSegments]=url`);
      for (const s of seg.slice(0, 1)) {
        const buf = Buffer.from(await (await fetch(s.attributes.url)).arrayBuffer());
        const text = buf[0] === 0x1f ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
        const z = text.split(/\r?\n/).filter(Boolean);
        const kopf = z[0].split("\t");
        console.log(`    Segment ${neu.attributes?.granularity} ${neu.attributes?.processingDate}: ${z.length - 1} Zeilen`);
        console.log(`    Spalten: ${kopf.join(" | ")}`);
        const ie = kopf.indexOf("Event"), ic = kopf.indexOf("Counts");
        if (ie >= 0 && ic >= 0) {
          const s2 = {};
          for (const r of z.slice(1)) { const f = r.split("\t"); s2[f[ie]] = (s2[f[ie]] ?? 0) + Number(f[ic] || 0); }
          console.log(`    Summen: ${JSON.stringify(s2)}`);
        }
      }
    }
  } catch (e) {
    console.log(`  FEHLER ${e.message}`);
  }
}
