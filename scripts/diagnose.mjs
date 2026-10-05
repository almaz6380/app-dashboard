// Zusammenfassung des Worker-Zustands fuer .github/workflows/diagnose.yml.
import { readFileSync } from "node:fs";

const z = JSON.parse(readFileSync(process.argv[2], "utf8"));
const zeit = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "-");

console.log(`Letzter Lauf: ${zeit(z.lauf)}`);
console.log(`\nFehler im letzten Lauf:`);
for (const [k, v] of Object.entries(z.fehler ?? {})) console.log(`  ${k}: ${v}`);

console.log(`\nApple Sales-Berichte (${Object.keys(z.apple ?? {}).length} gespeichert):`);
for (const [k, b] of Object.entries(z.apple ?? {}).sort()) {
  const summe = Object.values(b.units ?? {}).reduce((s, n) => s + n, 0);
  console.log(`  ${k}: ${b.fehlt ? "fehlt (404)" : `${summe} Units`} · geholt ${zeit(b.geholt)}`);
}

const a = z.analytik ?? {};
console.log(`\nApple Analytics:`);
for (const [app, x] of Object.entries(a.anfragen ?? {})) console.log(`  App ${app}: ${x.ids.length} Anforderungen, geholt ${zeit(x.geholt)}${x.fehler ? `, FEHLER ${x.fehler}` : ""}`);
for (const [anf, b] of Object.entries(a.berichte ?? {})) console.log(`  Anforderung ${anf} (App ${b.app}): Bericht ${b.id ?? "noch keiner"}`);
for (const [ber, i] of Object.entries(a.instanzen ?? {})) console.log(`  Bericht ${ber} (App ${i.app}): ${i.ids.length} Instanzen, ${i.ids.filter((id) => a.erledigt?.[id]).length} ausgewertet`);
for (const [app, tage] of Object.entries(a.loeschungen ?? {})) console.log(`  Loeschungen App ${app}: ${Object.entries(tage).map(([k, n]) => `${k}=${n}`).join(", ")}`);

console.log(`\nGoogle Play (je Paket die letzten Monatsdateien):`);
const jePaket = {};
for (const n of z.playDateien ?? []) {
  const m = /installs_(.+)_(\d{6})_overview/.exec(n);
  if (m) (jePaket[m[1]] ??= []).push([m[2], z.play?.[n]]);
}
for (const [p, l] of Object.entries(jePaket)) {
  console.log(`  ${p}: ` + l.slice(-3).map(([monat, d]) => `${monat} aktiv=${d?.aktiv ?? "?"} installs=${d?.installs ?? "?"} deinst=${d?.deinst ?? "?"} (geholt ${zeit(d?.geholt)})`).join(" | "));
}
