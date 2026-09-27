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
  ios: Metric; // Apple App Store
  android: Metric; // Google Play
  downloads: Metric; // iOS + Android, soweit verfuegbar
};

const NOT_CONFIGURED: Metric = { value: null, status: "not-configured" };
// App liegt in diesem Store gar nicht -> "-" statt "einrichten".
const NOT_IN_STORE: Metric = {
  value: null,
  status: "not-configured",
  detail: "nicht im Store",
};

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
  // Beide Quellen einmal fuer alle Apps holen.
  const packages = APPS.map((a) => a.androidPackage).filter(
    (p): p is string => Boolean(p),
  );
  const [apple, google] = await Promise.all([
    getAppleDownloads(),
    getGoogleInstalls(packages),
  ]);

  // Pro Plattform eine eigene Zelle. Drei Faelle:
  //   Zahl          - Quelle verbunden und liefert Daten
  //   "-"           - App liegt in diesem Store nicht
  //   "einrichten"  - Store-ID fehlt oder die Quelle ist nicht verbunden bzw.
  //                   klemmt gerade (z.B. Google-Zugriff propagiert noch)
  function iosFor(app: AppDef): Metric {
    if (!app.stores.includes("ios")) return NOT_IN_STORE;
    if (!app.appleAppId || apple.status !== "ok") return NOT_CONFIGURED;
    return { value: apple.byAppleId.get(app.appleAppId) ?? 0, status: "ok" };
  }

  function androidFor(app: AppDef): Metric {
    if (!app.stores.includes("android")) return NOT_IN_STORE;
    if (!app.androidPackage || google.status !== "ok") return NOT_CONFIGURED;
    return {
      value: google.byPackage.get(app.androidPackage) ?? 0,
      status: "ok",
    };
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

  const apps = await Promise.all(
    APPS.map(async (app) => {
      const members = app.hasMembers
        ? await countSupabaseRows(app)
        : { value: null, status: "not-configured" as const, detail: "keine Konten" };
      const ios = iosFor(app);
      const android = androidFor(app);
      return {
        id: app.id,
        name: app.name,
        members,
        ios,
        android,
        downloads: totalFor(ios, android),
      };
    }),
  );
  return { apps, fetchedAt, partial };
}
