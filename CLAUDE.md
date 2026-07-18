@AGENTS.md

# App-Dashboard

Privates Ein-Personen-Dashboard, das pro App **Downloads** und **Mitglieder** anzeigt — nur aggregierte Zahlen, keine personenbezogenen Daten. Zugriff nur per Passwort (nur der Besitzer).

Live: https://app-dashboard-nu-six.vercel.app · Deploy via `vercel --prod` (kein Git-Trigger).

## Stack
Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, Node ≥ 24. Deploy auf Vercel.

## Struktur
- `lib/apps.ts` — zentrale App-Liste (Name, `appleAppId`, `androidPackage`, `membersEnv`). Neue App = hier eintragen.
- `lib/metrics.ts` — führt die Quellen zusammen; `getAllMetrics()` liefert pro App `downloads` + `members`. Downloads = Apple (iOS) + Google (Android), summiert.
- `lib/appstore.ts` — Apple App Store Connect: Sales-Summary-Reports (JWT ES256 via `jose`), summiert Erst-Download-Units (Product Type „1"/„F1"; Updates/IAP ausgeschlossen) pro Apple-ID. 6h-Cache.
- `lib/googleplay.ts` — Google Play: liest `Total User Installs` aus `stats/installs/installs_<paket>_<JJJJMM>_overview.csv` (UTF-16) im Report-Bucket (Service-Account-JWT RS256 → OAuth → Storage-JSON-API). 6h-Cache.
- `lib/auth.ts` + `proxy.ts` — Passwort-Login. **Next 16: „middleware" heißt jetzt `proxy.ts` (Funktion `proxy`).**
- `app/page.tsx` — Dashboard-Tabelle. `app/login` + `app/api/login|logout` — Auth.

## Env-Variablen (in `.env.local` lokal, in Vercel prod)
- `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET` (HMAC-Cookie-Schlüssel)
- Apple: `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY` (.p8-Inhalt), `APPSTORE_VENDOR_NUMBER`, `APPSTORE_START_YEAR`
- Google: `GOOGLE_SERVICE_ACCOUNT_JSON` (kompletter JSON in einer Zeile), `GOOGLE_PLAY_BUCKET` (`pubsite_prod_…`, hier ohne `rev_`)
- Mitglieder (optional, noch nicht befüllt): `WELLBOOKED_SUPABASE_URL`/`_SERVICE_KEY`, `MYPEAK_SUPABASE_URL`/`_SERVICE_KEY` → `count(*)` auf `profiles`

Siehe `.env.example`. **`.env.local` niemals committen** (ist ge-ignored).

## Zu beachten
- Zahlen aktualisieren sich beim Seitenaufruf, max. alle 6h neu geladen; Store-Daten selbst hängen ~1 Tag (Apple) bzw. ~2–3 Tage (Google) hinterher.
- Google braucht (a) Bucket-Freigabe des Service-Accounts in der Play Console (kann bis 24h propagieren) und (b) einen existierenden Monatsbericht — sonst keine Zahlen.
- Nicht verbundene/klemmende Quellen zeigen „einrichten" (kein „Fehler"); Apps ohne Konten zeigen bei Mitglieder „–".
