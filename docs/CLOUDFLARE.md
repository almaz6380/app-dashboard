# Betrieb auf Cloudflare (seit 30.09.2026)

## Warum

Am 28.09.2026 hat Vercel den ganzen Hobby-Account pausiert, weil eine andere App ihr
Blob-Kontingent überschritten hatte; das Dashboard war damit tot. Cloudflare Workers Free
kostet nichts und sperrt bei Überschreitung nur den einzelnen Aufruf.

Die Schlüssel ließen sich nicht mitnehmen: Alle Variablen waren in Vercel „sensitive“
und sind auch über die API nicht lesbar. Sie werden neu erzeugt und als GitHub-Secrets
eingetragen (Tabelle unten).

## Aufbau

| Datei | Aufgabe |
|---|---|
| `worker/index.ts` | Login (`dash_auth`, gleiche HMAC-Logik aus `lib/auth.ts`), Übersicht, Abmelden, Cron |
| `worker/sammeln.ts` | holt je Lauf nur wenige Berichte, speichert je Datei/Bericht das Ergebnis in KV |
| `worker/seiten.ts` | HTML ohne Framework |
| `wrangler.toml` | KV-Namensraum `DATEN`, Cron alle 10 Minuten |

**Die wichtigste Grenze: 10 ms CPU je Aufruf**, auch für Cron-Läufe. Rechnen zählt,
Warten auf Netz nicht. Die Next.js-Fassung hat bei jedem Seitenaufruf alle Berichte neu
geholt und entpackt (gemessen 10–28 ms) — das darf hier nie wieder passieren. Deshalb:

- Abgeschlossene Play-Monate und Apple-Berichte werden **einmal** geholt und nie wieder.
- Veränderlich sind nur der laufende und der letzte Play-Monat (alle 3 h neu) und
  noch nicht erschienene Apple-Berichte (404, alle 6 h neu).
- Je Lauf höchstens 8 Play-Dateien und 2 Apple-Berichte (`MAX_PLAY`, `MAX_APPLE`).
- Die Seite liest nur den fertigen KV-Wert `uebersicht`.

Beim ersten Mal füllt sich der Bestand über einige Läufe (etwa eine Stunde). „Jetzt
einen Schritt abrufen“ auf der leeren Seite stößt einen Lauf von Hand an.

## Befehle

```bash
npm run test:worker   # Rechenlogik aus worker/sammeln.ts, ohne Netz
npm run worker:dev    # lokal, Werte aus .dev.vars (gitignored)
```

## GitHub-Secrets

Unter Settings → Secrets and variables → Actions. Leere Secrets überschreiben bei
Cloudflare nichts.

| Name | Pflicht | Woher |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ja | Cloudflare → Profil → API-Token |
| `DASHBOARD_PASSWORD` | ja | frei gewählt |
| `DASHBOARD_SECRET` | nein | wird beim ersten Deploy einmalig erzeugt |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | für Android | Google Cloud → IAM → Dienstkonten → Schlüssel → JSON (ganze Datei) |
| `GOOGLE_PLAY_BUCKET` | für Android | Play Console → Berichte herunterladen → „Cloud Storage-URI kopieren“ |
| `WELLBOOKED_SUPABASE_URL`, `WELLBOOKED_SUPABASE_SERVICE_KEY` | für Mitglieder | Supabase → Projekt → Settings → API |
| `MYPEAK_SUPABASE_URL`, `MYPEAK_SUPABASE_SERVICE_KEY` | für Mitglieder | wie oben, FullRep-Projekt |
| `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY`, `APPSTORE_VENDOR_NUMBER` | nein | nur für „neu“-Zeilen unbekannter iOS-Apps |
