import { NextResponse } from "next/server";

import { APPS } from "@/lib/apps";
import { fordereAn, leseAnfragen } from "@/lib/appleanalytics";
import { makeJwt, readConfig } from "@/lib/appstore";

// Einmalige Anforderung der Analytics-Berichte je App. SCHREIBZUGRIFF auf
// App Store Connect, darum nur per POST und nur hinter dem Passwort
// (proxy.ts schuetzt alles ausser /login). Vorhandene Anforderungen werden
// nicht doppelt gestellt.
export async function POST() {
  const cfg = readConfig();
  if (!cfg)
    return NextResponse.json(
      { fehler: "APPSTORE_* Umgebungsvariablen fehlen" },
      { status: 400 },
    );

  let jwt: string;
  try {
    jwt = await makeJwt(cfg);
  } catch (e) {
    return NextResponse.json(
      { fehler: e instanceof Error ? e.message : "JWT-Fehler" },
      { status: 500 },
    );
  }

  const ergebnisse: { app: string; ergebnis: string }[] = [];
  for (const app of APPS) {
    if (!app.appleAppId) continue;
    const vorhanden = await leseAnfragen(jwt, app.appleAppId);
    if ("fehler" in vorhanden) {
      ergebnisse.push({ app: app.name, ergebnis: `Lesen: ${vorhanden.fehler}` });
      continue;
    }
    // ONGOING = taegliche Berichte ab jetzt. ONE_TIME_SNAPSHOT = die
    // vorhandene Historie, einmalig.
    for (const typ of ["ONGOING", "ONE_TIME_SNAPSHOT"] as const) {
      if (vorhanden.some((a) => a.accessType === typ)) {
        ergebnisse.push({ app: app.name, ergebnis: `${typ}: schon vorhanden` });
        continue;
      }
      const r = await fordereAn(jwt, app.appleAppId, typ);
      ergebnisse.push({
        app: app.name,
        ergebnis: "fehler" in r ? `${typ}: ${r.fehler}` : `${typ}: angefordert`,
      });
    }
  }

  return NextResponse.json({ ergebnisse });
}
