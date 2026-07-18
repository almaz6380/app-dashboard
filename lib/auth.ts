// Einfacher Passwort-Schutz fuer ein Ein-Personen-Dashboard.
// Cookie-Wert = HMAC(secret, konstante) -> ohne den geheimen Schluessel
// nicht faelschbar. Reicht fuer "nur ich".

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const AUTH_COOKIE = "dash_auth";

export async function expectedToken(): Promise<string> {
  const secret = process.env.DASHBOARD_SECRET || "dev-secret-change-me";
  return hmacHex(secret, "app-dashboard-auth-v1");
}

export async function isValidToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedToken();
  // laengengleicher Vergleich (nicht kritisch bei einem Nutzer, aber sauber)
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++)
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(input: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return false; // ohne gesetztes Passwort kein Login moeglich
  if (input.length !== pw.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++)
    diff |= input.charCodeAt(i) ^ pw.charCodeAt(i);
  return diff === 0;
}
