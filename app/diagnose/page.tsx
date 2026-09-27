import Link from "next/link";

import {
  diagnose,
  SPALTE_AKTIV,
  SPALTE_DEINSTALLS,
  SPALTE_INSTALLS,
} from "@/lib/googleplay";

export const dynamic = "force-dynamic";

// Diagnoseseite fuer die Google-Play-Zahlen. Zeigt alle Pakete im Bucket,
// die Spaltennamen und die Summen je Monat. Liegt hinter dem Passwort
// (proxy.ts). Kann geloescht werden, sobald die Zahlen dauerhaft stimmen.
export default async function DiagnosePage() {
  const d = await diagnose();

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
              Bucket: <code className="text-neutral-300">{d.bucket}</code> ·{" "}
              {d.pakete.length} Paket(e) gefunden
            </p>

            {d.pakete.map((p) => (
              <section
                key={p.paket}
                className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <h2 className="font-medium break-all">{p.paket}</h2>

                {p.fehler ? (
                  <p className="mt-2 text-sm text-red-400">{p.fehler}</p>
                ) : (
                  <>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                      {(
                        [
                          ["installiert", p.gesamt.installs],
                          ["aktuell", p.gesamt.aktuell],
                          ["deinstalliert", p.gesamt.deinstalliert],
                        ] as [string, number | null][]
                      ).map(([label, wert]) => (
                        <div key={label} className="rounded-xl bg-neutral-950 p-2">
                          <dt className="text-[10px] uppercase tracking-wide text-neutral-500">
                            {label}
                          </dt>
                          <dd className="mt-0.5 font-semibold tabular-nums">
                            {zahl(wert)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2 text-xs text-neutral-500">
                      {p.dateien} Monatsdatei(en) im Bucket
                    </p>

                    <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
                      Spalten
                    </p>
                    <ol className="mt-1 text-xs text-neutral-300">
                      {p.spalten.map((s, i) => (
                        <li key={s + i} className="break-all">
                          <span className="text-neutral-600">{i}</span> {s}
                          {s === SPALTE_INSTALLS && (
                            <span className="text-amber-400"> ← installiert</span>
                          )}
                          {s === SPALTE_AKTIV && (
                            <span className="text-amber-400"> ← aktuell</span>
                          )}
                          {s === SPALTE_DEINSTALLS && (
                            <span className="text-amber-400"> ← deinstalliert</span>
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
                      Je Monat
                    </p>
                    <ul className="mt-1 space-y-2 text-xs">
                      {p.monate.map((m) => (
                        <li key={m.datei} className="border-t border-neutral-800 pt-2">
                          <div className="break-all text-neutral-300">{m.datei}</div>
                          <div className="mt-0.5 tabular-nums text-neutral-400">
                            installiert{" "}
                            <span className="font-semibold text-neutral-100">
                              {zahl(m.installs)}
                            </span>{" "}
                            · aktuell {zahl(m.aktuell)} · deinstalliert{" "}
                            {zahl(m.deinstalliert)} · {m.tage} Tageszeilen
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
