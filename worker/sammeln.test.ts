// Reine Logik aus worker/sammeln.ts, ohne Netz. Ausfuehren: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { playAuswahl, playJePaket, appleAuftraege, appleAuswahl, uebersicht, leererZustand } from "./sammeln";

const datei = (paket: string, monat: string) => `stats/installs/installs_${paket}_${monat}_overview.csv`;
const JETZT = Date.UTC(2026, 8, 30, 12); // 30.09.2026

test("playAuswahl: erst fehlende (neueste zuerst), dann veraenderliche Monate, gedeckelt", () => {
  const dateien = ["202607", "202608", "202609"].map((m) => datei("at.x", m)).concat(datei("at.y", "202609"));
  const alt = JETZT - 4 * 3600_000;
  const play = { [datei("at.x", "202607")]: { installs: 1, deinst: 0, aktiv: 1, geholt: alt }, [datei("at.x", "202608")]: { installs: 1, deinst: 0, aktiv: 1, geholt: alt } };
  const wahl = playAuswahl(dateien.sort(), play, JETZT, 3);
  assert.deepEqual(wahl, [datei("at.y", "202609"), datei("at.x", "202609"), datei("at.x", "202608")]);
  // Juli ist abgeschlossen und wird nie wieder geholt.
  assert.ok(!playAuswahl(dateien.sort(), play, JETZT, 10).includes(datei("at.x", "202607")));
});

test("playJePaket: Installationen summiert, aktiv aus juengstem Monat, Luecke = unvollstaendig", () => {
  const z = leererZustand();
  z.playDateien = [datei("at.x", "202608"), datei("at.x", "202609"), datei("at.y", "202609")];
  z.play[datei("at.x", "202608")] = { installs: 10, deinst: 1, aktiv: 7, geholt: 1 };
  z.play[datei("at.x", "202609")] = { installs: 5, deinst: 0, aktiv: 9, geholt: 1 };
  const p = playJePaket(z);
  assert.deepEqual(p.get("at.x"), { installs: 15, aktiv: 9, vollstaendig: true });
  assert.equal(p.get("at.y")?.vollstaendig, false);
});

test("appleAuftraege: Jahre, Monate, Tage; fehlender Vormonat wird durch Tage ersetzt", () => {
  const a = appleAuftraege(2025, JETZT, {});
  assert.ok(a.includes("YEARLY:2025") && a.includes("MONTHLY:2026-08") && a.includes("DAILY:2026-09-29"));
  assert.ok(!a.includes("DAILY:2026-09-30") && !a.includes("DAILY:2026-08-31"));
  const mitLuecke = appleAuftraege(2025, JETZT, { "MONTHLY:2026-08": { fehlt: true, geholt: JETZT } });
  assert.ok(mitLuecke.includes("DAILY:2026-08-31") && mitLuecke.includes("DAILY:2026-08-01"));
  // Frisch als fehlend markiert -> nicht sofort wieder holen.
  assert.ok(!appleAuswahl(mitLuecke, { "MONTHLY:2026-08": { fehlt: true, geholt: JETZT } }, JETZT, 100).includes("MONTHLY:2026-08"));
});

test("uebersicht: bekannte Apps mit Android-Zahl, unbekanntes Paket als neu", () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "a@b", private_key: "x" });
  process.env.GOOGLE_PLAY_BUCKET = "gs://pubsite_prod_rev_1";
  const z = leererZustand();
  z.playDateien = [datei("at.gallab.swaply", "202609"), datei("com.unbekannt", "202609")];
  z.play[datei("at.gallab.swaply", "202609")] = { installs: 40, deinst: 3, aktiv: 31, geholt: 1 };
  z.play[datei("com.unbekannt", "202609")] = { installs: 2, deinst: 0, aktiv: 2, geholt: 1 };
  z.lauf = JETZT;
  const u = uebersicht(z, JETZT);
  assert.equal(u.zeilen.find((r) => r.id === "swaply")?.android.value, 31);
  assert.equal(u.zeilen.find((r) => r.id === "doppeldeutsch")?.ios.detail, "nicht im Store");
  assert.equal(u.zeilen.find((r) => r.id === "play:com.unbekannt")?.neu, true);
  assert.equal(u.unvollstaendig, false);
});
