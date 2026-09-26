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
  downloads: Metric;
};

const NOT_CONFIGURED: Metric = { value: null, status: "not-configured" };

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

  // Downloads = iOS (Apple) + Android (Google), soweit verfuegbar.
  // Nicht eingerichtete Quellen werden ignoriert; nur wenn KEINE relevante
  // Quelle Daten liefert und eine davon fehlt/faellt, zeigen wir das an.
  function downloadsFor(app: AppDef): Metric {
    // Summiert alle Quellen, die tatsaechlich Daten liefern (Apple iOS +
    // Google Android). Quellen, die noch nicht verbunden sind oder gerade
    // klemmen (z.B. Google-Zugriff propagiert noch), werden ignoriert und
    // erscheinen als "einrichten" statt als Fehler.
    let sum = 0;
    let gotData = false;

    if (app.appleAppId && apple.status === "ok") {
      sum += apple.byAppleId.get(app.appleAppId) ?? 0;
      gotData = true;
    }
    if (app.androidPackage && google.status === "ok") {
      sum += google.byPackage.get(app.androidPackage) ?? 0;
      gotData = true;
    }

    return gotData ? { value: sum, status: "ok" } : NOT_CONFIGURED;
  }

  const okSources = [apple, google].filter((r) => r.status === "ok");
  const fetchedAt = okSources.length
    ? Math.min(...okSources.map((r) => r.fetchedAt))
    : null;
  const partial = okSources.some((r) => r.partial);

  const apps = await Promise.all(
    APPS.map(async (app) => {
      const [members, downloads] = await Promise.all([
        app.hasMembers
          ? countSupabaseRows(app)
          : Promise.resolve<Metric>({
              value: null,
              status: "not-configured",
              detail: "keine Konten",
            }),
        Promise.resolve(downloadsFor(app)),
      ]);
      return { id: app.id, name: app.name, members, downloads };
    }),
  );
  return { apps, fetchedAt, partial };
}
