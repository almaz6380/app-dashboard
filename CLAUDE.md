@AGENTS.md

# App-Dashboard

Privates Ein-Personen-Dashboard: pro App **aktuelle Installationen** (iOS, Android) und
**Mitglieder** — nur aggregierte Zahlen, keine personenbezogenen Daten. Zugriff nur per
Passwort (nur der Besitzer).

**Läuft seit 30.09.2026 als Cloudflare Worker** (`worker/`), nicht mehr auf Vercel —
Vercel hatte den ganzen Account pausiert. Adresse: `https://app-dashboard.almaz6380.workers.dev`.
Aufbau, CPU-Grenze (10 ms je Aufruf), Secrets: **`docs/CLOUDFLARE.md` zuerst lesen.**
Die Next.js-Dateien (`app/`, `proxy.ts`, `lib/metrics.ts`) bleiben nur als Rückweg
liegen und laufen nirgends; `lib/` wird vom Worker mitbenutzt.

## Struktur
- `worker/index.ts` — Login, Übersicht, `/api/stand` (Seite lädt sich selbst neu), Cron alle 10 min.
- `worker/sammeln.ts` — holt je Lauf nur wenige Berichte, speichert Zustand + fertige Übersicht in Workers KV (`DATEN`). Seitenaufrufe lesen nur KV.
- `worker/seiten.ts` — HTML ohne Framework.
- `lib/apps.ts` — zentrale App-Liste (Name, `appleAppId`, `androidPackage`, `membersEnv`). Neue App = hier eintragen; Apps, die nur in einer Quelle auftauchen, erscheinen als „neu“.
- `lib/appstore.ts` — Apple Sales-Berichte (JWT ES256 via `jose`): Erst-Downloads je Apple-ID.
- `lib/appleanalytics.ts` — Apple Analytics Reports API (Anforderung → Bericht → Instanz → Segment) für die Löschungen.
- `lib/googleplay.ts` — Google Play: `stats/installs/…_overview.csv` (UTF-16) aus dem Report-Bucket; Android = „Active Device Installs“.
- `lib/auth.ts` — Passwort-Login (HMAC-Cookie `dash_auth`).

## Wie die Zahlen entstehen
- **Android** = Geräte, auf denen die App jetzt liegt (Google, hängt 2–3 Tage nach).
- **iOS** = Erst-Downloads (Sales) minus Löschungen (Analytics-Bericht „App Store Installation and Deletion Standard“), angezeigt als „ca.“. Solange Apple für eine App keine Löschungen liefert, steht dort die Download-Zahl mit dem Zusatz „Downloads“ (zählt nicht in die Kachel „Aktuell installiert“).
- Kleine Apps bekommen von Apple oft **nur Wochen- und Monatsberichte**, keine Tage (Datenschutzschwelle). Der Worker liest alle Granularitäten; `loeschungenSumme` verhindert Doppelzählung (Monat vor Woche vor Tag).
- Die Analytics-Anforderungen (`ONGOING` + `ONE_TIME_SNAPSHOT`) stellt der Worker selbst, sobald ein Schlüssel mit Admin-Rolle da ist. Kein Knopf nötig.

## Deploy und Diagnose (GitHub Actions, nur von Hand)
- **„Cloudflare veroeffentlichen“** (`deploy.yml`): testet, veröffentlicht, überträgt die GitHub-Secrets zu Cloudflare. Nur nach ausdrücklichem „ja“ (siehe unten). Nach dem Deploy erscheinen neue Zahlen erst mit dem nächsten Cron-Lauf (≤ 10 min).
- **„Diagnose“** (`diagnose.yml`): **nur lesen**, ändert nichts, braucht kein „ja“. Zeigt den Worker-Zustand aus KV, die Play-Berichte und je App, was Apple im Installationsbericht hat (`scripts/apple-instanzen.mjs`). Erste Anlaufstelle, wenn Zahlen fehlen.
- Lokal: `npm run test:worker` (Rechenlogik ohne Netz), `npx wrangler deploy --dry-run` (baut).

## Secrets
Alle als **GitHub-Secrets** (Settings → Secrets and variables → Actions); der Deploy
überträgt sie zu Cloudflare, leere überschreiben nichts. Vollständige Liste mit Herkunft:
`docs/CLOUDFLARE.md`. Kurz: `CLOUDFLARE_API_TOKEN`/`_ACCOUNT_ID`, `DASHBOARD_PASSWORD`,
`APPSTORE_*` (+ optional `APPSTORE_ADMIN_*`), `GOOGLE_SERVICE_ACCOUNT_JSON`,
`GOOGLE_PLAY_BUCKET`, `WELLBOOKED_SUPABASE_*`, `MYPEAK_SUPABASE_*`.

## Zu beachten
- Nicht verbundene/klemmende Quellen zeigen „einrichten“ (kein „Fehler“); Apps ohne Konten zeigen bei Mitglieder „–“.
- Vor dem Bauen nachsehen, ob es schon einen offenen Branch/PR dazu gibt — am 04.10. wurde Apple doppelt gebaut, weil die Live-Version von einem ungemergten Branch kam. Live-Stand = letzter erfolgreicher Lauf von „Cloudflare veroeffentlichen“ (Branch steht im Lauf).

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
| Store-, Google-, Supabase-Schlüssel des Dashboards | GitHub-Secrets (siehe oben); lokal `.dev.vars` (gitignored) |

Ein Schlüssel, der im Chat steht, steht dauerhaft im Sitzungsprotokoll → gilt als
verbrannt und muss ersetzt werden. Fehlt einer: sagen **welcher** und **wo er
hingehört**, statt zu raten oder einen Umweg zu bauen.

**fal.ai läuft in der Sitzung** (Josef braucht dafür kein Terminal):
`curl -s https://fal.run/<modell> -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d '{"prompt":"…"}'`
→ Bild herunterladen, ins Repo legen, committen, im Chat zeigen. Ohne gesetzten
`FAL_KEY` ist der Weg zu: dann sagen, dass die Variable in der Umgebung fehlt.

**Auslösen in diesem Repo:** Keine App-Builds. Deploy nur über den Workflow
„Cloudflare veroeffentlichen“ (kein Git-Trigger, kein `vercel --prod` mehr) und nur nach
Freigabe. Der Workflow „Diagnose“ liest nur und braucht keine Freigabe. Schlüssel
liegen als GitHub-Secrets — niemals ins Repo, niemals in den Chat.
