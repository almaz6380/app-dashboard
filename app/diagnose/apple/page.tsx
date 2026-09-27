import Link from "next/link";

import { diagnoseApple } from "@/lib/appleanalytics";
import { readAdminConfig } from "@/lib/appstore";

export const dynamic = "force-dynamic";

// Diagnoseseite fuer die Apple Analytics Reports. Laeuft die Kette
// Anforderung -> Bericht -> Instanz -> Segment durch und zeigt, wo sie
// abbricht. Liegt hinter dem Passwort (proxy.ts).
export default async function AppleDiagnosePage() {
  const d = await diagnoseApple();
  const adminSchluessel = readAdminConfig() !== null;

  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Apple-Analytics-Diagnose</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Anforderung → Bericht → Instanz → Segment. Nur aggregierte Zahlen.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          <Link href="/" className="underline">
            zurück zum Dashboard
          </Link>{" "}
          ·{" "}
          <Link href="/diagnose" className="underline">
            Google-Diagnose
          </Link>
        </p>

        {"fehler" in d ? (
          <p className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {d.fehler}
          </p>
        ) : (
          <>
            <form
              action="/api/apple-report-request"
              method="post"
              className="mt-6 rounded-2xl border border-amber-900 bg-amber-950/30 p-4"
            >
              <p className="text-sm text-amber-200">
                Berichte einmalig anfordern
              </p>
              <p className="mt-1 text-xs text-amber-200/70">
                Schreibt in dein App-Store-Connect-Konto: je App eine laufende
                und eine einmalige Anforderung. Braucht einen Schlüssel mit
                Admin-Rolle. Danach dauert es 24–48 h bis zum ersten Bericht.
              </p>
              <p className="mt-1 text-xs">
                {adminSchluessel ? (
                  <span className="text-emerald-400">
                    Admin-Schlüssel ist hinterlegt (APPSTORE_ADMIN_*).
                  </span>
                ) : (
                  <span className="text-amber-400">
                    Kein Admin-Schlüssel hinterlegt – Apple wird das mit HTTP
                    403 ablehnen. Nötig: APPSTORE_ADMIN_KEY_ID und
                    APPSTORE_ADMIN_PRIVATE_KEY in der Vercel-Env.
                  </span>
                )}
              </p>
              <button className="mt-3 rounded-lg border border-amber-700 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-900/40">
                Jetzt anfordern
              </button>
            </form>

            {d.apps.map((a) => (
              <section
                key={a.appleAppId}
                className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <h2 className="font-medium">
                  {a.name}{" "}
                  <span className="text-xs font-normal text-neutral-500">
                    {a.appleAppId}
                  </span>
                </h2>

                {a.fehler && (
                  <p className="mt-2 break-all text-sm text-red-400">{a.fehler}</p>
                )}

                <ul className="mt-2 space-y-1 text-xs text-neutral-400">
                  <li>
                    Anforderungen:{" "}
                    {a.anfragen.length === 0 ? (
                      <span className="text-amber-400">keine</span>
                    ) : (
                      a.anfragen
                        .map(
                          (r) =>
                            r.accessType +
                            (r.stoppedDueToInactivity ? " (gestoppt)" : ""),
                        )
                        .join(", ")
                    )}
                  </li>
                  <li>Berichte: {a.berichte.length}</li>
                  <li>
                    Instanzen (täglich): {a.instanzen}
                    {a.neuesteInstanz && ` · neueste ${a.neuesteInstanz}`}
                  </li>
                  <li>Segmente: {a.segmente}</li>
                  <li>Datenzeilen: {a.zeilen}</li>
                </ul>

                {a.berichte.length > 0 && (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
                      Verfügbare Berichte
                    </p>
                    <ul className="mt-1 text-xs text-neutral-300">
                      {a.berichte.map((b) => (
                        <li key={b.id} className="break-all">
                          {b.name}{" "}
                          <span className="text-neutral-600">{b.category}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {a.spalten.length > 0 && (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
                      Spalten des neuesten Segments
                    </p>
                    <ol className="mt-1 text-xs text-neutral-300">
                      {a.spalten.map((s, i) => (
                        <li key={s + i} className="break-all">
                          <span className="text-neutral-600">{i}</span> {s}
                        </li>
                      ))}
                    </ol>
                  </>
                )}

                {a.beispielZeile && (
                  <p className="mt-2 break-all text-xs text-neutral-600">
                    letzte Zeile: {a.beispielZeile}
                  </p>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
