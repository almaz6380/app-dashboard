@AGENTS.md

# App-Dashboard

Privates Ein-Personen-Dashboard, das pro App **Downloads** und **Mitglieder** anzeigt — nur aggregierte Zahlen, keine personenbezogenen Daten. Zugriff nur per Passwort (nur der Besitzer).

Live: https://app-dashboard-nu-six.vercel.app · Deploy via `vercel --prod` (kein Git-Trigger).

## Stack
Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, Node ≥ 24. Deploy auf Vercel.

## Struktur
- `lib/apps.ts` — zentrale App-Liste (Name, `appleAppId`, `androidPackage`, `membersEnv`). Neue App = hier eintragen.
- `lib/metrics.ts` — führt die Quellen zusammen; `getAllMetrics()` liefert pro App `downloads` + `members`. Downloads = Apple (iOS) + Google (Android), summiert.
- `lib/appleanalytics.ts` — Apple Analytics Reports API (Anforderung → Bericht → Instanz → Segment). Liefert perspektivisch die *aktuellen* iOS-Installationen, die die Sales-Reports nicht kennen. Diagnose unter `/diagnose/apple`.
- `lib/appstore.ts` — Apple App Store Connect: Sales-Summary-Reports (JWT ES256 via `jose`), summiert Erst-Download-Units (Product Type „1"/„F1"; Updates/IAP ausgeschlossen) pro Apple-ID. 6h-Cache.
- `lib/googleplay.ts` — Google Play: liest `Total User Installs` aus `stats/installs/installs_<paket>_<JJJJMM>_overview.csv` (UTF-16) im Report-Bucket (Service-Account-JWT RS256 → OAuth → Storage-JSON-API). 6h-Cache.
- `lib/auth.ts` + `proxy.ts` — Passwort-Login. **Next 16: „middleware" heißt jetzt `proxy.ts` (Funktion `proxy`).**
- `app/page.tsx` — Dashboard-Tabelle. `app/login` + `app/api/login|logout` — Auth.

## Env-Variablen (in `.env.local` lokal, in Vercel prod)
- `DASHBOARD_PASSWORD`, `DASHBOARD_SECRET` (HMAC-Cookie-Schlüssel)
- Apple: `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY` (.p8-Inhalt), `APPSTORE_VENDOR_NUMBER`, `APPSTORE_START_YEAR`
- Apple Analytics (optional): `APPSTORE_ADMIN_KEY_ID`, `APPSTORE_ADMIN_PRIVATE_KEY` — **nur** zum einmaligen Anfordern der Analytics-Berichte über `/diagnose/apple`. Apple verlangt dafür die Admin-Rolle; zum Abholen genügt danach der normale Schlüssel. Issuer-ID wird geteilt.
- Google: `GOOGLE_SERVICE_ACCOUNT_JSON` (kompletter JSON in einer Zeile), `GOOGLE_PLAY_BUCKET` (`pubsite_prod_…`, hier ohne `rev_`)
- Mitglieder (optional, noch nicht befüllt): `WELLBOOKED_SUPABASE_URL`/`_SERVICE_KEY`, `MYPEAK_SUPABASE_URL`/`_SERVICE_KEY` → `count(*)` auf `profiles`

Siehe `.env.example`. **`.env.local` niemals committen** (ist ge-ignored).

## Zu beachten
- Zahlen aktualisieren sich beim Seitenaufruf, max. alle 6h neu geladen; Store-Daten selbst hängen ~1 Tag (Apple) bzw. ~2–3 Tage (Google) hinterher.
- Google braucht (a) Bucket-Freigabe des Service-Accounts in der Play Console (kann bis 24h propagieren) und (b) einen existierenden Monatsbericht — sonst keine Zahlen.
- Nicht verbundene/klemmende Quellen zeigen „einrichten" (kein „Fehler"); Apps ohne Konten zeigen bei Mitglieder „–".

---

## Handy-Betrieb: Builds, Deploys und fal.ai auf Zuruf

Josef arbeitet meist vom Handy. Für **alle** Sitzungen dieses Repos gilt darum eine
Dauer-Freigabe. Sie sagt nur, *dass* Claude das darf — sie ersetzt nie das „ja" zum
einzelnen Lauf.

**Grundsätzlich erlaubt:**
- Deploys auslösen
- fal.ai für Bildmaterial nutzen (Grafiken, Icons, Illustrationen)

**Bedingung, ausnahmslos:** Jeder einzelne Lauf braucht vorher ein ausdrückliches
„ja" von Josef im Chat. Davor in drei Zeilen zusammenfassen: *was* passiert, *welche
Versionsnummer*, *wohin* es geht (Store / Produktion / nur Artefakt zum Ansehen) —
bei fal.ai zusätzlich Modell, Anzahl Bilder und ungefähre Kosten. Geht etwas schief:
melden und stehen bleiben, nicht auf eigene Faust nachbessern und noch einmal
hochladen. Ergebnisse (Bilder, Build-Artefakte, Logs) mit `SendUserFile` direkt im
Chat zeigen — auf dem Handy gibt es keinen Dateimanager.

**Schlüssel gehören weder ins Repo noch in den Chat:**

| Zweck | Ort |
|---|---|
| Signierung + Store-Upload | GitHub → Repo → Settings → Secrets and variables → Actions |
| `FAL_KEY` | Umgebungsvariable der Claude-Umgebung (claude.ai/code → Environment) |
| Vercel / Supabase | Vercel-Env bzw. lokale `.env` (gitignored) |

Ein Schlüssel, der im Chat steht, steht dauerhaft im Sitzungsprotokoll → gilt als
verbrannt und muss ersetzt werden. Fehlt einer: sagen **welcher** und **wo er
hingehört**, statt zu raten oder einen Umweg zu bauen.

**fal.ai läuft in der Sitzung** (Josef braucht dafür kein Terminal):
`curl -s https://fal.run/<modell> -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d '{"prompt":"…"}'`
→ Bild herunterladen, ins Repo legen, committen, im Chat zeigen. Ohne gesetzten
`FAL_KEY` ist der Weg zu: dann sagen, dass die Variable in der Umgebung fehlt.

**Auslösen in diesem Repo:** Keine App-Builds. Deploy per `vercel --prod` (kein
Git-Trigger) und nur nach Freigabe. Die Store- und Supabase-Schlüssel liegen in der
Vercel-Env bzw. lokal in `.env.local` — niemals ins Repo, niemals in den Chat.
