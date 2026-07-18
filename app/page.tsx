import { getAllMetrics, Metric } from "@/lib/metrics";

export const dynamic = "force-dynamic";

function fmt(m: Metric): string {
  if (m.status === "ok" && m.value !== null)
    return m.value.toLocaleString("de-AT");
  if (m.status === "not-configured")
    return m.detail === "keine Konten" ? "–" : "einrichten";
  return "Fehler";
}

function cellClass(m: Metric): string {
  if (m.status === "ok") return "text-neutral-100 font-semibold tabular-nums";
  if (m.status === "error") return "text-red-400 text-sm";
  return "text-neutral-500 text-sm";
}

export default async function DashboardPage() {
  const metrics = await getAllMetrics();

  const totalMembers = metrics.reduce(
    (s, m) => s + (m.members.status === "ok" ? m.members.value ?? 0 : 0),
    0,
  );
  const totalDownloads = metrics.reduce(
    (s, m) => s + (m.downloads.status === "ok" ? m.downloads.value ?? 0 : 0),
    0,
  );

  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">App-Dashboard</h1>
            <p className="text-sm text-neutral-400">
              Downloads &amp; Mitglieder – nur Zahlen.
            </p>
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
              Downloads gesamt
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {totalDownloads > 0
                ? totalDownloads.toLocaleString("de-AT")
                : "—"}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-neutral-800">
          <table className="w-full text-left">
            <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3 text-right">Downloads</th>
                <th className="px-4 py-3 text-right">Mitglieder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {metrics.map((m) => (
                <tr key={m.id} className="bg-neutral-950">
                  <td className="px-4 py-4 font-medium">{m.name}</td>
                  <td
                    className={`px-4 py-4 text-right ${cellClass(m.downloads)}`}
                  >
                    {fmt(m.downloads)}
                  </td>
                  <td className={`px-4 py-4 text-right ${cellClass(m.members)}`}>
                    {fmt(m.members)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-neutral-600">
          „–" = kein Nutzerkonto-System · „einrichten" = Quelle noch nicht
          verbunden · Seite neu laden aktualisiert die Zahlen.
        </p>
      </div>
    </main>
  );
}
