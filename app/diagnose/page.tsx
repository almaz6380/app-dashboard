import Link from "next/link";

import { APPS } from "@/lib/apps";
import { diagnose, INSTALL_COLUMN } from "@/lib/googleplay";

export const dynamic = "force-dynamic";

// Diagnoseseite fuer die Google-Play-Zahlen. Zeigt, welche Monatsdateien im
// Bucket liegen, wie die Spalten heissen und welche Summen jeder Monat ergibt.
// Liegt hinter dem Passwort (proxy.ts). Kann geloescht werden, sobald die
// Android-Zahlen stimmen.
export default async function DiagnosePage() {
  const pakete = APPS.map((a) => a.androidPackage).filter(
    (p): p is string => Boolean(p),
  );
  const d = await diagnose(pakete);

  const zahl = (n: number | null) =>
    n === null ? "–" : n.toLocaleString("de-AT");

  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Google-Play-Diagnose</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Was tatsächlich im Report-Bucket liegt. Nur aggregierte Zahlen.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          <Link href="/" className="underline">
            zurück zum Dashboard
          </Link>
        </p>

        {"fehler" in d ? (
          <p className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {d.fehler}
          </p>
        ) : (
          <>
            <p className="mt-6 text-xs text-neutral-500">
              Bucket: <code className="text-neutral-300">{d.bucket}</code>
            </p>

            {d.pakete.map((p) => (
              <section
                key={p.paket}
                className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-medium break-all">{p.paket}</h2>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {zahl(p.summe)}
                  </span>
                </div>

                {p.fehler ? (
                  <p className="mt-2 text-sm text-red-400">{p.fehler}</p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-neutral-500">
                      {p.dateien} Monatsdatei(en) gefunden · Summe ={" "}
                      {INSTALL_COLUMN} über alle Tage
                    </p>

                    <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
                      Spalten
                    </p>
                    <ol className="mt-1 text-xs text-neutral-300">
                      {p.spalten.map((s, i) => (
                        <li key={s + i} className="break-all">
                          <span className="text-neutral-600">{i}</span> {s}
                          {s === INSTALL_COLUMN && (
                            <span className="text-amber-400"> ← gelesen</span>
                          )}
                          {s === "Total User Installs" && (
                            <span className="text-neutral-600">
                              {" "}
                              ← früher gelesen, immer 0
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>

                    <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
                      Summe je Monat
                    </p>
                    <ul className="mt-1 space-y-2 text-xs">
                      {p.monate.map((m) => (
                        <li key={m.datei} className="border-t border-neutral-800 pt-2">
                          <div className="break-all text-neutral-300">
                            {m.datei} →{" "}
                            <span className="font-semibold tabular-nums text-neutral-100">
                              {zahl(m.nutzerInstalls)}
                            </span>
                          </div>
                          <div className="mt-0.5 tabular-nums text-neutral-500">
                            Geräte-Installs {zahl(m.geraeteInstalls)} · aktive
                            Geräte {zahl(m.aktivGeraete)} · {m.tage} Tageszeilen
                          </div>
                          {m.letzteZeile && (
                            <div className="mt-0.5 break-all text-neutral-600">
                              letzte Zeile: {m.letzteZeile}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
