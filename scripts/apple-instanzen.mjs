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
      // Jede Instanz: je Datum-Wert die Summen je Event (nur Zahlen) - zeigt, welche
      // Tage Wochen- und Monatsberichte abdecken.
      for (const neu of inst) {
      const seg = await alle(`/analyticsReportInstances/${neu.id}/segments?fields[analyticsReportSegments]=url`);
      for (const s of seg) {
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
          const id = kopf.indexOf("Date"), je = {};
          for (const r of z.slice(1)) { const f = r.split("\t"); const k = `${f[id]} ${f[ie]}`; je[k] = (je[k] ?? 0) + Number(f[ic] || 0); }
          console.log(`    je Datum: ${Object.entries(je).sort().map(([k, n]) => `${k}=${n}`).join(", ")}`);
        }
      }
      }
    }
  } catch (e) {
    console.log(`  FEHLER ${e.message}`);
  }
}

// Store-Status je App: ist ueberhaupt eine Version veroeffentlicht?
console.log("\nStore-Versionen (neueste zuerst):");
const konto = await alle("/apps?fields[apps]=name,bundleId&limit=200");
for (const a of konto) {
  try {
    const v = await alle(`/apps/${a.id}/appStoreVersions?fields[appStoreVersions]=versionString,appStoreState,platform,createdDate&limit=5`);
    console.log(`  ${a.id}  ${a.attributes?.name}: ` + (v.map((x) => `${x.attributes?.platform} ${x.attributes?.versionString} ${x.attributes?.appStoreState} (angelegt ${String(x.attributes?.createdDate).slice(0, 10)})`).join(" | ") || "keine Version"));
  } catch (e) { console.log(`  ${a.id}  ${a.attributes?.name}: FEHLER ${e.message}`); }
}

// Sales-Tagesberichte der letzten 35 Tage: Units je App und Product Type Identifier,
// ALLE Arten (1* = Erst-Download, 3* = erneutes Laden, 7* = Update). Das Dashboard
// zaehlt nur 1*/F1 - hier sieht man, ob eine App nur unter anderen Arten auftaucht.
if (env.APPSTORE_VENDOR_NUMBER) {
  const je = {}, titel = {};
  let berichte = 0;
  for (let t = 1; t <= 35; t++) {
    const datum = new Date(Date.now() - t * 86400000).toISOString().slice(0, 10);
    const res = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=${encodeURIComponent(env.APPSTORE_VENDOR_NUMBER)}&filter[reportDate]=${datum}&filter[version]=1_0`,
      { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/a-gzip" } });
    if (!res.ok) continue;
    berichte++;
    const z = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8").split("\n").filter(Boolean);
    const k = z[0].split("\t"), iU = k.indexOf("Units"), iT = k.indexOf("Product Type Identifier"), iI = k.indexOf("Apple Identifier"), iN = k.indexOf("Title");
    for (const r of z.slice(1)) {
      const f = r.split("\t"), id = (f[iI] ?? "").trim(), art = (f[iT] ?? "").trim();
      titel[id] = (f[iN] ?? "").trim();
      ((je[id] ??= {})[art] ??= { units: 0, erster: datum, letzter: datum }).units += Number(f[iU]) || 0;
      if (datum < je[id][art].erster) je[id][art].erster = datum;
      if (datum > je[id][art].letzter) je[id][art].letzter = datum;
    }
  }
  console.log(`\nSales je App und Art, letzte 35 Tage (${berichte} Tagesberichte):`);
  for (const [id, arten] of Object.entries(je)) console.log(`  ${id}  ${titel[id]}: ` + Object.entries(arten).sort().map(([a, x]) => `Art ${a} = ${x.units} (${x.erster} bis ${x.letzter})`).join(", "));
  for (const a of konto) if (!je[a.id]) console.log(`  ${a.id}  ${a.attributes?.name}: in keinem Tagesbericht`);
} else console.log("\nAPPSTORE_VENDOR_NUMBER fehlt - Sales je Art uebersprungen");

// Alle Apps im App-Store-Connect-Konto (Name, Apple-ID, Bundle-ID) - zum Abgleich mit lib/apps.ts.
console.log("\nApps im Konto:");
for (const a of await alle("/apps?fields[apps]=name,bundleId&limit=200")) {
  const bekannt = apps.some((x) => x.id === a.id) ? "" : "   <- fehlt in lib/apps.ts";
  console.log(`  ${a.id}  ${a.attributes?.name}  (${a.attributes?.bundleId})${bekannt}`);
}
