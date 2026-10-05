// HTML der beiden Seiten. Bewusst ohne Framework: Die Uebersicht ist eine Tabelle
// mit einer Handvoll Zahlen, und jede Millisekunde CPU zaehlt (Workers Free: 10 ms).
// Aussehen wie die Next.js-Fassung: dunkel, Karten auf dem Handy, Tabelle ab 640 px.
import type { Metric, Uebersicht } from "./sammeln";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
/* Kein overscroll-behavior hier: Diese Seite baut der Server, Neuladen IST das
   Aktualisieren, und ein eigenes Runterziehen gibt es nicht. Wer es abschaltet,
   nimmt die einzige verlaessliche Art weg, frische Zahlen zu holen. */
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100dvh;background:#0a0a0a;color:#f5f5f5;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:56rem;margin:0 auto;padding:16px}@media(min-width:640px){main{padding:32px}}
h1{font-size:1.25rem;margin:0}.leise{color:#a3a3a3;font-size:.875rem;margin:0}.fein{color:#909090;font-size:.75rem}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:12px}
button{background:none;border:1px solid #262626;border-radius:8px;color:#a3a3a3;padding:6px 12px;font:inherit;font-size:.875rem;cursor:pointer}
button:hover{color:#f5f5f5}.kacheln{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
.kachel,.karte{border:1px solid #262626;background:#171717;border-radius:16px;padding:16px}
.etikett{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#909090}
.gross{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;margin-top:4px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 0;text-align:center}
dl div{background:#0a0a0a;border-radius:12px;padding:8px}dd{margin:2px 0 0}
.ok{font-weight:600;font-variant-numeric:tabular-nums}.aus{color:#909090;font-size:.875rem}.fehler{color:#f87171;font-size:.875rem}
.neu{margin-left:4px;font-size:.625rem;text-transform:uppercase;letter-spacing:.05em;color:#f59e0b}
table{display:none;width:100%;border-collapse:collapse;border:1px solid #262626;border-radius:16px;overflow:hidden}
th{background:#171717;color:#909090;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:12px 16px}
td{padding:14px 16px;border-top:1px solid #262626}th:not(:first-child),td:not(:first-child){text-align:right}
@media(min-width:640px){table{display:table}ul.karten{display:none}}
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
    if (m.detail === "Downloads") return `${zahl(m.value)} <span class="fein">Downloads</span>`;
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
  const summe = (pick: (z: Uebersicht["zeilen"][number]) => Metric) =>
    u.zeilen.reduce((s, z) => s + (pick(z).status === "ok" ? pick(z).value ?? 0 : 0), 0);
  // iOS-Downloads sind keine Installationen und zaehlen in der Kachel nicht mit.
  const iosInstalliert = (z: Uebersicht["zeilen"][number]): Metric => (z.ios.detail === "Downloads" ? { value: null, status: "not-configured" } : z.ios);
  const hatIos = u.zeilen.some((z) => iosInstalliert(z).status === "ok");
  const hatAndroid = u.zeilen.some((z) => z.android.status === "ok");
  const quellen = hatIos && hatAndroid ? "iOS + Android" : hatAndroid ? "nur Android – iOS zeigt vorerst Downloads" : hatIos ? "nur iOS" : "";
  const zellen = (z: Uebersicht["zeilen"][number]): [string, Metric][] => [["iOS", z.ios], ["Android", z.android], ["Mitglieder", z.mitglieder]];
  const name = (z: Uebersicht["zeilen"][number]) => `${esc(z.name)}${z.neu ? '<span class="neu">neu</span>' : ""}`;

  return rahmen("App-Dashboard", `
<header>
  <div>
    <h1>App-Dashboard</h1>
    <p class="leise">Aktuelle Installationen &amp; Mitglieder – nur Zahlen.</p>
    ${stand ? `<p class="fein">Stand: ${stand} Uhr</p>` : ""}
  </div>
  <div style="display:flex;gap:8px">
    <button type="button" onclick="location.reload()">Aktualisieren</button>
    <form method="post" action="/api/logout"><button>Abmelden</button></form>
  </div>
</header>
<div class="kacheln">
  <div class="kachel"><div class="etikett">Mitglieder gesamt</div><div class="gross">${zahl(summe((z) => z.mitglieder))}</div></div>
  <div class="kachel"><div class="etikett">Aktuell installiert</div><div class="gross">${hatIos || hatAndroid ? zahl(summe(iosInstalliert) + summe((z) => z.android)) : "—"}</div>
    <div class="fein">${quellen}</div></div>
</div>
<ul class="karten">${u.zeilen.map((z) => `
  <li class="karte"><strong>${name(z)}</strong>
    <dl>${zellen(z).map(([l, m]) => `<div><dt class="etikett">${l}</dt><dd class="${klasse(m)}">${fmt(m)}</dd></div>`).join("")}</dl>
  </li>`).join("")}
</ul>
<table>
  <thead><tr><th>App</th><th>iOS</th><th>Android</th><th>Mitglieder</th></tr></thead>
  <tbody>${u.zeilen.map((z) => `<tr><td>${name(z)}</td>${zellen(z).map(([, m]) => `<td class="${klasse(m)}">${fmt(m)}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
${u.unvollstaendig ? `<p class="warn">Einige Store-Berichte fehlen noch oder konnten nicht geladen werden – Zahlen evtl. zu niedrig. Der Abruf alle 10 Minuten holt sie nach.${u.hinweise.length ? `<br>${u.hinweise.slice(0, 5).map(esc).join("<br>")}` : ""}</p>` : ""}
<p class="fein" style="margin-top:16px">Gezeigt werden <b>aktuelle Installationen</b>, keine Gesamt-Downloads. Gelöschte Installationen zählen nicht. <b>Android</b> = Geräte, auf denen die App jetzt liegt (Google „Active Device Installs“; in der Play Console vergleichbar mit „Installierte Zielgruppe“ nach <i>Geräten</i>, hängt 2–3 Tage nach). <b>iOS</b> = Erst-Downloads minus Löschungen (ca.: Apple meldet Löschungen nur von Nutzern mit Analyse-Freigabe, die Zahl liegt darum eher etwas zu hoch). Solange Apple die Löschungen noch nicht liefert, steht dort vorerst die Zahl der <b>Downloads</b> (Erst-Downloads, ohne Löschungen). „–“ = nicht in diesem Store bzw. kein Nutzerkonto-System · „neu“ = in der Quelle gefunden, aber noch nicht in <code>lib/apps.ts</code> benannt.</p>`, u.stand);
}
