// Einstieg fuer Cloudflare Workers (seit 30.09.2026, vorher Next.js auf Vercel).
//
// Vercel hatte den ganzen Hobby-Account pausiert, weil eine andere App ihr
// Kontingent gesprengt hatte - mit ihm dieses Dashboard. Workers Free kostet nichts
// und sperrt bei Ueberschreitung nur den einzelnen Aufruf.
//
// Aufteilung: Der Cron (alle 10 Minuten) holt schrittweise Berichte und legt Zustand
// und fertige Uebersicht in Workers KV ab (worker/sammeln.ts). Ein Seitenaufruf liest
// nur die Uebersicht und baut daraus HTML (worker/seiten.ts). So bleibt jeder Aufruf
// weit unter der Grenze von 10 ms CPU.
import { AUTH_COOKIE, checkPassword, expectedToken, isValidToken } from "../lib/auth";
import { einLauf, leererZustand, uebersicht, type Uebersicht, type Zustand } from "./sammeln";
import { loginSeite, uebersichtSeite } from "./seiten";

type Env = { DATEN: KVNamespace; LOGIN_LIMIT?: RateLimit; [k: string]: unknown };

// Sicherheits-Header fuer jede Antwort. Inline-CSS und das kleine Inline-Script
// (Selbst-Aktualisierung, worker/seiten.ts) kommen aus dem eigenen Code, nie aus
// Nutzereingaben; nachgeladen wird nichts, eingebettet werden darf die Seite nicht.
const SICHERHEIT: Record<string, string> = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; " +
    "img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function absichern(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SICHERHEIT)) r.headers.set(k, v);
  return r;
}

const ZUSTAND = "zustand";
const UEBERSICHT = "uebersicht";
const DREISSIG_TAGE = 30 * 24 * 3600;

// lib/ liest process.env. Neuere Laufzeiten fuellen es selbst; doppelt schadet nicht.
function envUebernehmen(env: Env) {
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && process.env[k] !== v) process.env[k] = v;
}

function cookie(request: Request, name: string): string | undefined {
  for (const teil of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = teil.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

const html = (text: string, status = 200) =>
  new Response(text, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const weiter = (ziel: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location: ziel, ...headers } });

async function passwortAusAnfrage(request: Request): Promise<string> {
  // Das Formular schickt urlencoded; die alte Next.js-Loginseite schickte JSON.
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as { password?: string };
    return String(b.password ?? "");
  }
  const f = await request.formData().catch(() => null);
  return String(f?.get("password") ?? "");
}

async function lauf(env: Env): Promise<void> {
  const z = ((await env.DATEN.get<Zustand>(ZUSTAND, "json")) ?? leererZustand()) as Zustand;
  await einLauf(z);
  await env.DATEN.put(ZUSTAND, JSON.stringify(z));
  await env.DATEN.put(UEBERSICHT, JSON.stringify(uebersicht(z)));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return absichern(await antwort(request, env));
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    envUebernehmen(env);
    ctx.waitUntil(lauf(env));
  },
};

async function antwort(request: Request, env: Env): Promise<Response> {
  envUebernehmen(env);
  const url = new URL(request.url);
  // Nur HTTPS: Passwort und Cookie nie im Klartext.
  if (url.protocol === "http:" && url.hostname !== "localhost") {
    url.protocol = "https:";
    return new Response(null, { status: 301, headers: { location: url.toString() } });
  }
  const sicher = url.protocol === "https:" ? "; Secure" : "";

  if (url.pathname === "/login") return html(loginSeite());

  if (url.pathname === "/api/login" && request.method === "POST") {
    // Gegen Passwort-Raten: hoechstens 5 Versuche je Minute und IP (Cloudflare-
    // Rate-Limit, wrangler.toml), dazu 1 s Pause nach jedem Fehlversuch. Die Pause
    // ist Wartezeit, keine CPU-Zeit.
    const ip = request.headers.get("cf-connecting-ip") ?? "?";
    if (env.LOGIN_LIMIT && !(await env.LOGIN_LIMIT.limit({ key: ip })).success)
      return html(loginSeite("Zu viele Versuche. Bitte eine Minute warten."), 429);
    if (!checkPassword(await passwortAusAnfrage(request))) {
      await new Promise((r) => setTimeout(r, 1000));
      return html(loginSeite("Passwort falsch."), 401);
    }
    return weiter("/", {
      "set-cookie": `${AUTH_COOKIE}=${await expectedToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DREISSIG_TAGE}${sicher}`,
    });
  }

  if (url.pathname === "/api/logout") {
    return weiter("/login", { "set-cookie": `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${sicher}` });
  }

  // Alles andere nur mit gueltigem Cookie - wie proxy.ts in der Next.js-Fassung.
  if (!(await isValidToken(cookie(request, AUTH_COOKIE)))) return weiter("/login");

  if (url.pathname === "/api/aktualisieren" && request.method === "POST") {
    // Ein einzelner Schritt von Hand, etwa gleich nach dem Eintragen der Schluessel.
    await lauf(env);
    return weiter("/");
  }

  // Nur der Zeitstempel des letzten Laufs. Danach fragt die offene Seite im
  // Minutentakt, um neue Zahlen des Cron von selbst zu zeigen (worker/seiten.ts).
  // Ein KV-Lesevorgang, kein HTML - KV-Lesen ist bei Workers Free reichlich frei,
  // und geschrieben wird hier nichts, die 1000 Schreibvorgaenge bleiben dem Cron.
  if (url.pathname === "/api/stand") {
    const u = await env.DATEN.get<Uebersicht>(UEBERSICHT, "json");
    return new Response(JSON.stringify({ stand: u?.stand ?? null }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (url.pathname === "/") {
    const u = await env.DATEN.get<Uebersicht>(UEBERSICHT, "json");
    return html(uebersichtSeite(u));
  }

  return new Response("Nicht gefunden.", { status: 404 });
}
