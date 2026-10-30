// HTML der beiden Seiten. Bewusst ohne Framework: Die Uebersicht ist eine Tabelle
// mit einer Handvoll Zahlen, und jede Millisekunde CPU zaehlt (Workers Free: 10 ms).
// Dunkel; je Store eine eigene Tabelle mit Vergleich zu gestern und vor 7 Tagen.
import type { Metric, Uebersicht } from "./sammeln";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
/* Kein overscroll-behavior hier: Diese Seite baut der Server, Neuladen IST das
   Aktualisieren, und ein eigenes Runterziehen gibt es nicht. Wer es abschaltet,
   nimmt die einzige verlaessliche Art weg, frische Zahlen zu holen. */
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100dvh;background:#0a0a0a;color:#f5f5f5;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:56rem;margin:0 auto;padding:16px}@media(min-width:640px){main{padding:32px}}
h1{font-size:1.25rem;margin:0;white-space:nowrap}.leise{color:#a3a3a3;font-size:.875rem;margin:0}.fein{color:#909090;font-size:.75rem}
header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:24px;gap:12px}
button{background:none;border:1px solid #262626;border-radius:8px;color:#a3a3a3;padding:6px 12px;font:inherit;font-size:.875rem;cursor:pointer}
button:hover{color:#f5f5f5}.kacheln{display:grid;gap:12px;margin-bottom:24px}
.kachel,.karte{border:1px solid #262626;background:#171717;border-radius:16px;padding:16px}
.etikett{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#909090}
.gross{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;margin-top:4px}
.ok{font-weight:600;font-variant-numeric:tabular-nums}.aus{color:#909090;font-size:.875rem}.fehler{color:#f87171;font-size:.875rem}
.neu{margin-left:4px;font-size:.625rem;text-transform:uppercase;letter-spacing:.05em;color:#f59e0b}
.kacheln{grid-template-columns:repeat(3,1fr)}@media(max-width:480px){.kachel{padding:10px}.gross{font-size:1.2rem}.kachel .fein{font-size:.7rem}td{font-size:.875rem}}
.plus{color:#4ade80}.minus{color:#f87171}
section{margin-bottom:24px}h2{font-size:1rem;margin:0 0 8px}h2 .fein{font-weight:400}
.rahmen{border:1px solid #262626;border-radius:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{background:#171717;color:#909090;font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:10px 12px;white-space:nowrap}
td{padding:10px 12px;border-top:1px solid #262626;white-space:nowrap}th:not(:first-child),td:not(:first-child){text-align:right}
td:first-child{white-space:normal}tfoot td{background:#171717;font-weight:600}
th,td{padding:10px 8px}th:first-child,td:first-child{padding-left:12px}th:last-child,td:last-child{padding-right:12px}
@media(min-width:640px){th,td{padding:12px 16px!important}}
@media(max-width:480px){.breit{display:none}}
.warn{color:#fbbf24;font-size:.75rem;margin-top:16px}
form.login{max-width:20rem;margin:20vh auto 0;display:grid;gap:12px}
input{background:#171717;border:1px solid #262626;border-radius:8px;color:#f5f5f5;padding:10px 12px;font:inherit}
`;

// Die Seite ist am Server gebaut und aendert sich nur, wenn der Cron neue Zahlen
// geschrieben hat - sonst stand hier die Zahl von damals, bis jemand von Hand neu lud.
// Darum fragt sie im Minutentakt nur den Zeitstempel ab (/api/stand: ein KV-Lesevorgang,
// kein HTML, keine nennenswerte CPU) und laedt sich erst neu, wenn er sich geaendert hat.
// Sofort fragt sie, wenn das Fenster wieder nach vorn kommt; am Handy ist das der Moment,
// in dem veraltete Zahlen auffallen. Mehrere Ereignisse, weil keines allein reicht:
// visibilitychange bleibt auf dem iPhone aus, wenn die Seite aus dem Seiten-
// Zwischenspeicher zurueckkommt (pageshow) oder nur den Fokus wiederbekommt (focus).
// Bewusst von Hand geschrieben und winzig: kein Framework, nichts nachzuladen.
const selbstAktuell = (stand: number | null) => `<script>
(()=>{let s=${JSON.stringify(stand)},t=Date.now(),l=0;
const alt=()=>Date.now()-t>120000;
// Zurueck im Vordergrund: ist die Seite aelter als zwei Minuten, einfach neu laden.
// Ohne Frage an den Server, ohne Vergleich - beides kann am Handy stillstehen, und
// dann stand hier stundenlang eine alte Zahl. Die Seite ist winzig, das kostet nichts.
const v=()=>{if(!document.hidden&&alt())location.reload();};
// Im Hintergrund weiterlaufen lassen: nur fragen, neu laden bei neuem Stand.
const p=async()=>{if(document.hidden||Date.now()-l<2000)return;l=Date.now();
if(alt()){location.reload();return;}
try{const r=await fetch("/api/stand",{cache:"no-store"});const j=await r.json();
if(j.stand&&j.stand!==s)location.reload();}catch(e){}};
setInterval(p,60000);document.addEventListener("visibilitychange",v);
for(const e of ["pageshow","focus","online"])addEventListener(e,v);})();
</script>`;

function rahmen(titel: string, inhalt: string, stand?: number | null): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="robots" content="noindex"><title>${esc(titel)}</title><style>${CSS}</style></head>
<body><main>${inhalt}</main>${stand === undefined ? "" : selbstAktuell(stand)}</body></html>`;
}

const zahl = (n: number) => n.toLocaleString("de-AT");

function fmt(m: Metric): string {
  if (m.status === "ok" && m.value !== null) {
    if (m.detail === "Downloads") return `${zahl(m.value)} <span class="fein">DL</span>`;
    return m.detail === "ca." ? `ca. ${zahl(m.value)}` : zahl(m.value);
  }
  if (m.status === "not-configured" && m.detail === "lädt") return "lädt …";
  if (m.status === "not-configured") return m.detail === "keine Konten" || m.detail === "nicht im Store" ? "–" : "einrichten";
  return "Fehler";
}
const klasse = (m: Metric) => (m.status === "ok" ? "ok" : m.status === "error" ? "fehler" : "aus");

export function loginSeite(fehler?: string): string {
  return rahmen("Anmelden – App-Dashboard", `
<form class="login" method="post" action="/api/login">
  <h1>App-Dashboard</h1>
  <input type="password" name="password" placeholder="Passwort" autocomplete="current-password" required autofocus>
  <button type="submit">Anmelden</button>
  ${fehler ? `<p class="fehler">${esc(fehler)}</p>` : ""}
</form>`);
}

type Z = Uebersicht["zeilen"][number];

// +3 grün, −2 rot, ±0 grau, kein Vergleichswert "–".
function delta(n: number | null | undefined): string {
  if (n == null) return '<span class="aus">–</span>';
  if (n === 0) return '<span class="aus">±0</span>';
  return n > 0 ? `<span class="plus">+${zahl(n)}</span>` : `<span class="minus">−${zahl(-n)}</span>`;
}
const leer = (n: number | null | undefined) => (n == null ? '<span class="aus">–</span>' : zahl(n));
const tagKurz = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

// Summe nur, wenn mindestens eine Zeile einen Wert hat.
function summeVon(werte: (number | null | undefined)[]): number | null {
  const da = werte.filter((n): n is number => n != null);
  return da.length ? da.reduce((s, n) => s + n, 0) : null;
}

function tabelle(titel: string, unter: string, kopf: string[], zeilen: string[][], summe: string[] | null): string {
  const zelle = (t: string, c: string, i: number) => `<${t}${i >= 5 ? ' class="breit"' : ""}>${c}</${t}>`;
  return `<section><h2>${titel}${unter ? ` <span class="fein">${unter}</span>` : ""}</h2>
<div class="rahmen"><table>
<thead><tr>${kopf.map((k, i) => zelle("th", k, i)).join("")}</tr></thead>
<tbody>${zeilen.map((r) => `<tr>${r.map((c, i) => zelle("td", c, i)).join("")}</tr>`).join("")}</tbody>
${summe ? `<tfoot><tr>${summe.map((c, i) => zelle("td", c, i)).join("")}</tr></tfoot>` : ""}
</table></div></section>`;
}

function kachel(etikett: string, wert: number | null, d: number | null | undefined, fein = ""): string {
  return `<div class="kachel"><div class="etikett">${etikett}</div><div class="gross">${wert == null ? "—" : zahl(wert)}</div>
<div class="fein">${d === undefined ? "" : `${delta(d)} seit gestern`}${fein ? ` ${fein}` : ""}</div></div>`;
}

export function uebersichtSeite(u: Uebersicht | null): string {
  if (!u) {
    // Auch ohne Zahlen mit Skript: so erscheinen die ersten von selbst, sobald sie da sind.
    return rahmen("App-Dashboard", `<h1>App-Dashboard</h1>
<p class="leise">Noch keine Zahlen. Der erste Abruf läuft alle 10 Minuten; das Auffüllen dauert beim ersten Mal etwa eine Stunde.</p>
<form method="post" action="/api/aktualisieren"><button>Jetzt einen Schritt abrufen</button></form>`, null);
  }
  const stand = u.stand
    ? new Date(u.stand).toLocaleString("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const name = (z: Z) => `${esc(z.name)}${z.neu ? '<span class="neu">neu</span>' : ""}`;
  const wert = (m: Metric) => `<span class="${klasse(m)}">${fmt(m)}</span>`;
  const ok = (m: Metric) => (m.status === "ok" ? m.value : null);
  const imStore = (m: Metric) => m.detail !== "nicht im Store";

  // iOS: "Downloads" (noch ohne Löschungen) zählt nicht als installiert.
  const ios = u.zeilen.filter((z) => imStore(z.ios));
  const iosInst = (z: Z) => (z.ios.detail === "Downloads" ? null : ok(z.ios));
  const iosTab = tabelle("iOS", "installiert ca. = Downloads − Löschungen",
    ["App", "Aktuell", "Vortag", "7 Tage", "Neu", "Neu 7 T."],
    // "ca." steht schon in der Ueberschrift (≈) - spart am Handy eine Spaltenbreite.
    ios.map((z) => [name(z), z.ios.detail === "ca." ? wert({ ...z.ios, detail: undefined }) : wert(z.ios), delta(z.verlauf?.ios?.vortag), delta(z.verlauf?.ios?.woche),
      leer(z.verlauf?.iosDownloads?.gestern), leer(z.verlauf?.iosDownloads?.woche)]),
    ["Summe", leer(summeVon(ios.map(iosInst))), delta(summeVon(ios.map((z) => z.verlauf?.ios?.vortag))),
      delta(summeVon(ios.map((z) => z.verlauf?.ios?.woche))), leer(summeVon(ios.map((z) => z.verlauf?.iosDownloads?.gestern))),
      leer(summeVon(ios.map((z) => z.verlauf?.iosDownloads?.woche)))]);

  const android = u.zeilen.filter((z) => imStore(z.android));
  const googleTag = android.map((z) => z.verlauf?.android?.datum).filter((d): d is string => !!d).sort().pop();
  const androidTab = tabelle("Android", googleTag ? `aktive Geräte · Stand Google ${tagKurz(googleTag)}` : "aktive Geräte",
    ["App", "Aktiv", "Vortag", "7 Tage"],
    android.map((z) => [name(z), wert(z.android), delta(z.verlauf?.android?.vortag), delta(z.verlauf?.android?.woche)]),
    ["Summe", leer(summeVon(android.map((z) => ok(z.android)))), delta(summeVon(android.map((z) => z.verlauf?.android?.vortag))),
      delta(summeVon(android.map((z) => z.verlauf?.android?.woche)))]);

  const mit = u.zeilen.filter((z) => z.mitglieder.detail !== "keine Konten");
  const mitTab = mit.length ? tabelle("Mitglieder", "registrierte Konten", ["App", "Konten", "Vortag", "7 Tage"],
    mit.map((z) => [name(z), wert(z.mitglieder), delta(z.verlauf?.mitglieder?.vortag), delta(z.verlauf?.mitglieder?.woche)]),
    mit.length > 1 ? ["Summe", leer(summeVon(mit.map((z) => ok(z.mitglieder)))), delta(summeVon(mit.map((z) => z.verlauf?.mitglieder?.vortag))),
      delta(summeVon(mit.map((z) => z.verlauf?.mitglieder?.woche)))] : null) : "";

  return rahmen("App-Dashboard", `
<header>
  <div>
    <h1>App-Dashboard</h1>
    ${stand ? `<p class="fein">Stand: ${stand} Uhr</p>` : ""}
  </div>
  <div style="display:flex;gap:8px">
    <button type="button" onclick="location.reload()">Aktualisieren</button>
    <form method="post" action="/api/logout"><button>Abmelden</button></form>
  </div>
</header>
<div class="kacheln">
  ${kachel("iOS installiert", summeVon(ios.map(iosInst)), summeVon(ios.map((z) => z.verlauf?.ios?.vortag)))}
  ${kachel("Android aktiv", summeVon(android.map((z) => ok(z.android))), summeVon(android.map((z) => z.verlauf?.android?.vortag)))}
  ${kachel("Mitglieder", summeVon(mit.map((z) => ok(z.mitglieder))), summeVon(mit.map((z) => z.verlauf?.mitglieder?.vortag)))}
</div>
${iosTab}
${androidTab}
${mitTab}
${u.unvollstaendig ? `<p class="warn">Einige Store-Berichte fehlen noch oder konnten nicht geladen werden – Zahlen evtl. zu niedrig. Der Abruf alle 10 Minuten holt sie nach.${u.hinweise.length ? `<br>${u.hinweise.slice(0, 5).map(esc).join("<br>")}` : ""}</p>` : ""}
<p class="fein" style="margin-top:16px"><b>Vortag / 7 Tage</b> = Veränderung gegenüber gestern bzw. vor einer Woche; „–“ = noch kein Vergleichswert (iOS und Mitglieder merkt sich das Dashboard erst ab 30.10.2026 täglich). <b>Android</b> = Geräte, auf denen die App jetzt liegt (Google „Active Device Installs“, hängt 2–3 Tage nach; verglichen wird mit dem Tag davor laut Google). <b>iOS</b> = Erst-Downloads minus Löschungen (ca.: Apple meldet Löschungen nur von Nutzern mit Analyse-Freigabe, die Zahl liegt eher etwas zu hoch). Solange Apple die Löschungen noch nicht liefert, steht dort die Zahl der Downloads mit „DL“; sie zählt nicht in „iOS installiert“. <b>Neu</b> = Erst-Downloads gestern bzw. in den letzten 7 Tagen. „neu“ = in der Quelle gefunden, aber noch nicht in <code>lib/apps.ts</code> benannt.</p>`, u.stand);
}
