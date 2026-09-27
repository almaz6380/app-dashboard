import { getAllMetrics, AppMetrics, Metric } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function fmt(m: Metric): string {
  if (m.status === "ok" && m.value !== null)
    return m.value.toLocaleString("de-AT");
  if (m.status === "not-configured")
    return m.detail === "keine Konten" || m.detail === "nicht im Store"
      ? "–"
      : "einrichten";
  return "Fehler";
}

function cellClass(m: Metric): string {
  if (m.status === "ok") return "text-neutral-100 font-semibold tabular-nums";
  if (m.status === "error") return "text-red-400 text-sm";
  return "text-neutral-500 text-sm";
}

// Reihenfolge der Werte pro App - einmal definiert, von Karte und Tabelle
// gemeinsam genutzt. Gezeigt werden nur AKTUELLE Zahlen: Geraete, auf denen
// die App jetzt liegt. Gesamt-Downloads stehen bewusst nicht mehr hier.
function cellsOf(m: AppMetrics): [string, Metric][] {
  return [
    ["iOS", m.iosAktuell],
    ["Android", m.androidAktuell],
    ["Mitglieder", m.members],
  ];
}

export default async function DashboardPage() {
  const { apps: metrics, fetchedAt, partial } = await getAllMetrics();
  const stand = fetchedAt
    ? new Date(fetchedAt).toLocaleString("de-AT", {
        timeZone: "Europe/Vienna",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // Summiert nur Zellen mit echten Daten; "einrichten"/"-" zaehlen nicht mit.
  const sum = (pick: (m: AppMetrics) => Metric) =>
    metrics.reduce((s, m) => {
      const cell = pick(m);
      return s + (cell.status === "ok" ? cell.value ?? 0 : 0);
    }, 0);

  const totalMembers = sum((m) => m.members);
  const totalAktuell = sum((m) => m.androidAktuell);

  // Liefert die Quelle gar keine Daten, waere eine 0 gelogen - dann "-".
  const hasAktuell = metrics.some((m) => m.androidAktuell.status === "ok");

  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">App-Dashboard</h1>
            <p className="text-sm text-neutral-400">
              Aktuelle Installationen &amp; Mitglieder – nur Zahlen.
            </p>
            {stand && (
              <p className="mt-0.5 text-xs text-neutral-500">
                Stand: {stand} Uhr
              </p>
            )}
          </div>
          <form action="/api/logout" method="post">
            <button className="rounded-lg border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-100">
              Abmelden
            </button>
          </form>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Mitglieder gesamt
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {totalMembers.toLocaleString("de-AT")}
            </div>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Aktuell installiert
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {hasAktuell ? totalAktuell.toLocaleString("de-AT") : "—"}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              nur Android – Apple liefert das nicht
            </div>
          </div>
        </div>

        {/* Handy: je App eine Karte. Vier Tabellenspalten werden auf 390px
            zu eng, sobald eine Zelle "einrichten" statt einer Zahl zeigt. */}
        <ul className="space-y-3 sm:hidden">
          {metrics.map((m) => (
            <li
              key={m.id}
              className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium break-all">
                  {m.name}
                  {m.gefunden && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-500">
                      neu
                    </span>
                  )}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                {cellsOf(m).map(([label, cell]) => (
                  <div key={label} className="rounded-xl bg-neutral-950 p-2">
                    <dt className="text-[10px] uppercase tracking-wide text-neutral-500">
                      {label}
                    </dt>
                    <dd className={`mt-0.5 ${cellClass(cell)}`}>{fmt(cell)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        {/* Ab sm: klassische Tabelle. */}
        <div className="hidden overflow-hidden rounded-2xl border border-neutral-800 sm:block">
          <table className="w-full text-left">
            <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3 text-right">iOS</th>
                <th className="px-4 py-3 text-right">Android</th>
                <th className="px-4 py-3 text-right">Mitglieder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {metrics.map((m) => (
                <tr key={m.id} className="bg-neutral-950">
                  <td className="px-4 py-4 font-medium">
                    {m.name}
                    {m.gefunden && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-500">
                        neu
                      </span>
                    )}
                  </td>
                  {cellsOf(m).map(([label, cell]) => (
                    <td
                      key={label}
                      className={`px-4 py-4 text-right ${cellClass(cell)}`}
                    >
                      {fmt(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {partial && (
          <p className="mt-4 text-xs text-amber-400">
            Einige Store-Berichte konnten gerade nicht geladen werden – Zahlen
            evtl. zu niedrig. Neu laden versucht es erneut.
          </p>
        )}

        <p className="mt-4 text-xs text-neutral-600">
          Gezeigt werden <b>aktuelle Installationen</b>, keine Gesamt-Downloads.
          <b> Android</b> = Geräte, auf denen die App jetzt liegt (Google Play,
          vollzählig). <b>iOS</b> steht auf „einrichten“, weil Apples
          Sales-Reports nur Erst-Downloads enthalten; aktuelle Installationen
          gäbe es nur über die Analytics Reports API, und Apple blendet
          Nutzungszahlen unter fünf aktiven Geräten aus. · „–“ = nicht in
          diesem Store bzw. kein Nutzerkonto-System · „neu“ = in der Quelle
          gefunden, aber noch nicht in <code>lib/apps.ts</code> benannt ·
          Zahlen werden max. alle 6 h neu geholt und hängen 1–3 Tage hinterher.
        </p>
      </div>
    </main>
  );
}
