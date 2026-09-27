import { APPS, AppDef } from "@/lib/apps";
import { getAppleDownloads } from "@/lib/appstore";
import { getGoogleInstalls } from "@/lib/googleplay";

export type Metric = {
  value: number | null;
  status: "ok" | "not-configured" | "error";
  detail?: string;
};

export type AppMetrics = {
  id: string;
  name: string;
  members: Metric;
  ios: Metric; // Apple App Store, Erst-Downloads (derzeit nicht angezeigt)
  iosAktuell: Metric; // Apple App Store, aktuelle Installationen
  android: Metric; // Google Play, Nutzer die je installiert haben
  androidAktuell: Metric; // Google Play, aktuell installierte Geraete
  androidWeg: Metric; // Google Play, Deinstallationen
  downloads: Metric; // iOS + Android, soweit verfuegbar
  // true = nicht in lib/apps.ts, sondern automatisch in der Quelle gefunden.
  gefunden?: boolean;
};

const NOT_CONFIGURED: Metric = { value: null, status: "not-configured" };
// App liegt in diesem Store gar nicht -> "-" statt "einrichten".
const NOT_IN_STORE: Metric = {
  value: null,
  status: "not-configured",
  detail: "nicht im Store",
};
const NO_MEMBERS: Metric = {
  value: null,
  status: "not-configured",
  detail: "keine Konten",
};
// Apples Sales-Reports enthalten nur Erst-Downloads. Aktuelle Installationen
// gaebe es allein ueber die Analytics Reports API - die ist noch nicht
// angebunden, und Apple blendet Nutzungsmetriken unter fuenf aktiven Geraeten
// ohnehin aus. Bis dahin ehrlich "einrichten" statt einer anderen Groesse.
const APPLE_OHNE_AKTUELL: Metric = { value: null, status: "not-configured" };

// Zaehlt Zeilen einer Supabase-Tabelle ueber die REST-API,
// ohne Zeilendaten zu laden (HEAD + Prefer: count=exact).
// Es kommen KEINE personenbezogenen Daten zurueck, nur die Anzahl.
async function countSupabaseRows(app: AppDef): Promise<Metric> {
  const cfg = app.membersEnv;
  if (!cfg) return NOT_CONFIGURED;
  const url = process.env[cfg.urlVar];
  const key = process.env[cfg.keyVar];
  if (!url || !key) return NOT_CONFIGURED;

  try {
    const res = await fetch(`${url}/rest/v1/${cfg.table}?select=id`, {
      method: "HEAD",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { value: null, status: "error", detail: `HTTP ${res.status}` };
    }
    // Content-Range: "0-0/1234"  ->  Gesamtzahl nach dem Slash
    const cr = res.headers.get("content-range");
    const total = cr ? Number(cr.split("/")[1]) : NaN;
    if (Number.isFinite(total)) return { value: total, status: "ok" };
    return { value: null, status: "error", detail: "keine Anzahl im Header" };
  } catch (e) {
    return {
      value: null,
      status: "error",
      detail: e instanceof Error ? e.message : "Fehler",
    };
  }
}

export type DashboardData = {
  apps: AppMetrics[];
  // Aeltester Abfragezeitpunkt der verbundenen Store-Quellen (ms), null = keine.
  fetchedAt: number | null;
  // true, wenn eine Quelle nur teilweise Daten lieferte (Zahlen evtl. zu niedrig).
  partial: boolean;
};

export async function getAllMetrics(): Promise<DashboardData> {
  // Beide Quellen liefern alles, was das Konto hergibt - nicht nur die Apps
  // aus lib/apps.ts. Was dort fehlt, wird unten als eigene Zeile ergaenzt.
  const [apple, google] = await Promise.all([
    getAppleDownloads(),
    getGoogleInstalls(),
  ]);

  // Pro Plattform eine eigene Zelle. Drei Faelle:
  //   Zahl          - Quelle verbunden und liefert Daten
  //   "-"           - App liegt in diesem Store nicht
  //   "einrichten"  - Store-ID fehlt oder die Quelle ist nicht verbunden bzw.
  //                   klemmt gerade (z.B. Google-Zugriff propagiert noch)
  function iosFor(app: AppDef): Metric {
    if (!app.stores.includes("ios")) return NOT_IN_STORE;
    if (!app.appleAppId || apple.status !== "ok") return NOT_CONFIGURED;
    // Apple liefert EINEN Bericht ueber alle Apps des Accounts. Fehlt eine
    // Apple-ID darin, gab es im Zeitraum wirklich keine Downloads -> 0 stimmt.
    return { value: apple.byAppleId.get(app.appleAppId) ?? 0, status: "ok" };
  }

  // Anders als bei Apple liegt bei Google je App eine eigene Datei. Fehlt
  // der Eintrag, fehlt der Bericht - das heisst NICHT "0 Installationen".
  function androidFor(
    app: AppDef,
  ): { installs: Metric; aktuell: Metric; weg: Metric } {
    if (!app.stores.includes("android"))
      return { installs: NOT_IN_STORE, aktuell: NOT_IN_STORE, weg: NOT_IN_STORE };
    const z =
      app.androidPackage && google.status === "ok"
        ? google.byPackage.get(app.androidPackage)
        : undefined;
    if (!z)
      return {
        installs: NOT_CONFIGURED,
        aktuell: NOT_CONFIGURED,
        weg: NOT_CONFIGURED,
      };
    return {
      installs: zahl(z.installs),
      aktuell: zahl(z.aktuell),
      weg: zahl(z.deinstalliert),
    };
  }

  function zahl(n: number | null): Metric {
    return n === null ? NOT_CONFIGURED : { value: n, status: "ok" };
  }

  // Gesamt = Summe der Plattformen, die tatsaechlich Daten liefern. Liefert
  // keine etwas, bleibt die Zelle "einrichten" statt faelschlich 0.
  function totalFor(ios: Metric, android: Metric): Metric {
    const parts = [ios, android].filter((m) => m.status === "ok");
    if (parts.length === 0) return NOT_CONFIGURED;
    return {
      value: parts.reduce((s, m) => s + (m.value ?? 0), 0),
      status: "ok",
    };
  }

  const okSources = [apple, google].filter((r) => r.status === "ok");
  const fetchedAt = okSources.length
    ? Math.min(...okSources.map((r) => r.fetchedAt))
    : null;
  const partial = okSources.some((r) => r.partial);

  const apps: AppMetrics[] = await Promise.all(
    APPS.map(async (app) => {
      const members = app.hasMembers ? await countSupabaseRows(app) : NO_MEMBERS;
      const ios = iosFor(app);
      const a = androidFor(app);
      return {
        id: app.id,
        name: app.name,
        members,
        ios,
        iosAktuell: app.stores.includes("ios") ? APPLE_OHNE_AKTUELL : NOT_IN_STORE,
        android: a.installs,
        androidAktuell: a.aktuell,
        androidWeg: a.weg,
        downloads: totalFor(ios, a.installs),
      };
    }),
  );

  // ---- Alles ergaenzen, was die Quellen kennen, lib/apps.ts aber nicht ----
  // So faellt keine App durchs Raster, nur weil sie nicht eingetragen wurde.
  const bekanntePakete = new Set(
    APPS.map((a) => a.androidPackage).filter(Boolean),
  );
  const bekannteApple = new Set(APPS.map((a) => a.appleAppId).filter(Boolean));

  if (google.status === "ok") {
    for (const [paket, z] of google.byPackage) {
      if (bekanntePakete.has(paket)) continue;
      const installs = zahl(z.installs);
      apps.push({
        id: `play:${paket}`,
        name: paket,
        members: NO_MEMBERS,
        ios: NOT_IN_STORE,
        iosAktuell: NOT_IN_STORE,
        android: installs,
        androidAktuell: zahl(z.aktuell),
        androidWeg: zahl(z.deinstalliert),
        downloads: totalFor(NOT_CONFIGURED, installs),
        gefunden: true,
      });
    }
  }

  if (apple.status === "ok") {
    for (const [id, units] of apple.byAppleId) {
      if (bekannteApple.has(id)) continue;
      const ios: Metric = { value: units, status: "ok" };
      apps.push({
        id: `apple:${id}`,
        name: apple.titleByAppleId.get(id) ?? `Apple-ID ${id}`,
        members: NO_MEMBERS,
        ios,
        iosAktuell: APPLE_OHNE_AKTUELL,
        android: NOT_CONFIGURED,
        androidAktuell: NOT_CONFIGURED,
        androidWeg: NOT_CONFIGURED,
        downloads: totalFor(ios, NOT_CONFIGURED),
        gefunden: true,
      });
    }
  }

  return { apps, fetchedAt, partial };
}
