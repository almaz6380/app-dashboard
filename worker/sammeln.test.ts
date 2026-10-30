// Reine Logik aus worker/sammeln.ts, ohne Netz. Ausfuehren: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { playAuswahl, playJePaket, appleAuftraege, appleAuswahl, uebersicht, leererZustand, loeschungenAus, loeschungenMerken, loeschungenSumme, iosAktuell, leereAnalytik, androidVerlauf, iosDownloads, appleVerlaufAuftraege, wienerTag } from "./sammeln";
import { werteJeTag } from "../lib/googleplay";

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
  assert.equal(u.zeilen.find((r) => r.id === "mahjong")?.mitglieder.detail, "keine Konten");
  assert.equal(u.zeilen.find((r) => r.id === "play:com.unbekannt")?.neu, true);
  assert.equal(u.unvollstaendig, false);
});

const TSV = [
  "Date\tApp Name\tApp Apple Identifier\tEvent\tDownload Type\tTerritory\tCounts\tUnique Devices",
  "2026-09-28\tSwaply\t6787695557\tInstall\tFirst-time download\tAT\t5\t5",
  "2026-09-28\tSwaply\t6787695557\tDelete\t\tAT\t2\t2",
  "2026-09-28\tSwaply\t6787695557\tDelete\t\tDE\t1\t1",
  "2026-09-29\tSwaply\t6787695557\tDelete\t\tAT\t3\t3",
].join("\n");

test("loeschungenAus: nur Delete-Zeilen, je App und Tag summiert", () => {
  assert.deepEqual(loeschungenAus(TSV, "x"), { "6787695557": { "DAILY:2026-09-28": 3, "DAILY:2026-09-29": 3 } });
  assert.throws(() => loeschungenAus("A\tB\n1\t2", "x"), /Spalten unbekannt/);
});

test("loeschungenMerken: gleicher Tag aus Snapshot und laufender Anforderung zaehlt einmal", () => {
  const a = leereAnalytik();
  loeschungenMerken(a, loeschungenAus(TSV, "x"));
  loeschungenMerken(a, loeschungenAus(TSV, "x"));
  assert.deepEqual(a.loeschungen["6787695557"], { "DAILY:2026-09-28": 3, "DAILY:2026-09-29": 3 });
});

test("iosAktuell: Erst-Downloads minus Loeschungen, erst wenn alles geladen ist", () => {
  const app = "6787695557";
  const z = leererZustand();
  const auftraege = appleAuftraege(2026, JETZT, {});
  for (const k of auftraege) z.apple[k] = { units: { [app]: 2 }, geholt: 1 };
  // Ohne Loeschungen: vorerst die Downloads, als solche beschriftet.
  assert.deepEqual(iosAktuell(z, app, 2026, JETZT), { value: auftraege.length * 2, status: "ok", detail: "Downloads" });
  z.analytik!.instanzen.r1 = { app, ids: ["i1", "i2"], geholt: 1 };
  z.analytik!.erledigt.i1 = 1;
  assert.equal(iosAktuell(z, app, 2026, JETZT).detail, "Downloads");
  z.analytik!.erledigt.i2 = 1;
  loeschungenMerken(z.analytik!, loeschungenAus(TSV, app));
  const m = iosAktuell(z, app, 2026, JETZT);
  assert.equal(m.value, auftraege.length * 2 - 6);
  assert.equal(m.status, "ok");
  // Ein fehlender Sales-Bericht -> noch keine Zahl statt einer zu niedrigen.
  delete z.apple[auftraege[0]];
  assert.equal(iosAktuell(z, app, 2026, JETZT).detail, "lädt");
});

test("loeschungenSumme: Monat vor Woche vor Tag, nichts doppelt (echte Mahjong-Daten vom 05.10.)", () => {
  // Snapshot: Monate Aug + Sep, Wochen 10.08., 31.08., 21.09. - alle von Monaten abgedeckt.
  const tage = { "MONTHLY:2026-08-01": 7, "MONTHLY:2026-09-01": 5, "WEEKLY:2026-08-10": 2, "WEEKLY:2026-08-31": 2, "WEEKLY:2026-09-21": 3 };
  assert.equal(loeschungenSumme(tage), 12);
  // Oktober hat noch keinen Monat: Woche zaehlt, Tag in der Woche nicht, Tag danach schon.
  assert.equal(loeschungenSumme({ ...tage, "WEEKLY:2026-10-05": 2, "DAILY:2026-10-06": 1, "DAILY:2026-10-13": 4 }), 18);
});

test("werteJeTag: aktive Geraete je Datum, leere Zellen fehlen", () => {
  const csv = "Date,Package Name,Active Device Installs\n2026-10-01,at.x,10\n2026-10-02,at.x,\n2026-10-03,at.x,12";
  assert.deepEqual(werteJeTag(csv, "Active Device Installs"), { "2026-10-01": 10, "2026-10-03": 12 });
});

test("androidVerlauf: Vortag und 7 Tage ueber die Monatsgrenze, juengster Google-Tag zaehlt", () => {
  const z = leererZustand();
  z.playDateien = [datei("at.x", "202609"), datei("at.x", "202610")];
  z.play[datei("at.x", "202609")] = { installs: 0, deinst: 0, aktiv: 20, geholt: 1, tage: { "2026-09-27": 20 } };
  z.play[datei("at.x", "202610")] = { installs: 0, deinst: 0, aktiv: 25, geholt: 1, tage: { "2026-10-03": 23, "2026-10-04": 25 } };
  assert.deepEqual(androidVerlauf(z, "at.x"), { vortag: 2, woche: 5, datum: "2026-10-04" });
  // Alte Datei ohne Tage: kein Vergleich, kein Absturz.
  delete z.play[datei("at.x", "202610")].tage;
  assert.deepEqual(androidVerlauf(z, "at.x"), { vortag: null, woche: null, datum: "2026-09-27" });
});

test("iosDownloads: gestern und 7 Tage aus Tagesberichten, null solange einer fehlt", () => {
  const z = leererZustand();
  const tage = appleVerlaufAuftraege(JETZT);
  assert.equal(tage[6], "DAILY:2026-09-29");
  for (const k of tage) z.apple[k] = { units: { a1: 2 }, geholt: 1 };
  assert.deepEqual(iosDownloads(z, "a1", JETZT), { gestern: 2, woche: 14 });
  assert.deepEqual(iosDownloads(z, "andere", JETZT), { gestern: 0, woche: 0 });
  z.apple[tage[0]] = { fehlt: true, geholt: 1 };
  assert.deepEqual(iosDownloads(z, "a1", JETZT), { gestern: 2, woche: null });
});

test("Tages-Schnappschuss: Vergleich zu gestern, iOS nur bei gleicher Art, 40 Tage", () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const z = leererZustand();
  z.mitglieder.wellbooked = { value: 100, status: "ok" };
  z.verlauf = { "2026-09-29": { wellbooked: { m: 97 } }, "2026-08-01": { wellbooked: { m: 1 } } };
  const u = uebersicht(z, JETZT);
  const w = u.zeilen.find((r) => r.id === "wellbooked")!;
  assert.deepEqual(w.verlauf?.mitglieder, { vortag: 3, woche: null });
  assert.equal(z.verlauf["2026-09-30"].wellbooked.m, 100);
  assert.ok(!z.verlauf["2026-08-01"], "aelter als 40 Tage wird geloescht");
  assert.equal(wienerTag(Date.UTC(2026, 9, 29, 23, 30)), "2026-10-30");
});
