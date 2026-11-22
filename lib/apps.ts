// Zentrale Liste aller Apps im Dashboard.
// hasMembers: ob es echte registrierte Nutzer gibt (eigenes Backend).
// membersEnv: Namen der Umgebungsvariablen mit Supabase-URL + Service-Key.
// stores: in welchen Stores die App liegt (fuer die Download-Zahlen).

export type StoreKind = "ios" | "android";

export type AppDef = {
  id: string;
  name: string;
  hasMembers: boolean;
  membersEnv?: {
    urlVar: string;
    keyVar: string;
    table: string; // Tabelle, die 1:1 zu auth.users ist
  };
  stores: StoreKind[];
  // Store-IDs fuer die Download-APIs (spaeter befuellt):
  appleAppId?: string; // numerische App-Store-ID
  androidPackage?: string; // z.B. com.example.app
};

export const APPS: AppDef[] = [
  {
    id: "wellbooked",
    name: "WELLbooked!",
    hasMembers: true,
    membersEnv: {
      urlVar: "WELLBOOKED_SUPABASE_URL",
      keyVar: "WELLBOOKED_SUPABASE_SERVICE_KEY",
      table: "profiles",
    },
    stores: ["ios", "android"],
    appleAppId: "6781266042",
    androidPackage: "at.wellbooked.app",
  },
  {
    id: "mypeak",
    name: "FullRep", // frueher MyPeak (Env-Namen bleiben MYPEAK_*)
    hasMembers: true,
    membersEnv: {
      urlVar: "MYPEAK_SUPABASE_URL",
      keyVar: "MYPEAK_SUPABASE_SERVICE_KEY",
      table: "profiles",
    },
    stores: ["ios", "android"],
    appleAppId: "6788461300",
    androidPackage: "at.gallab.mypeak",
  },
  {
    id: "swaply",
    name: "Swaply",
    hasMembers: false, // rein lokal, keine Konten
    stores: ["ios", "android"],
    appleAppId: "6787695557",
    androidPackage: "at.gallab.swaply",
  },
  {
    id: "mahjong",
    name: "Mahjong Royale",
    hasMembers: false, // rein offline, keine Konten
    stores: ["ios", "android"],
    appleAppId: "6787721454",
    androidPackage: "com.mahjongroyale.app",
  },
  {
    id: "anigosha",
    name: "Anigosha",
    hasMembers: false, // Mitglieder-Quelle noch offen
    stores: ["ios", "android"],
    appleAppId: "6797757350",
    androidPackage: "at.gallab.animequiz",
  },
  {
    id: "doppeldeutsch",
    name: "Watten & Schnapsen",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6800774882",
    androidPackage: "at.doppeldeutsch.karten",
  },
  // Gefunden per Diagnose "Apps im Konto" (scripts/apple-instanzen.mjs), Pakete
  // laut Play Console. Stand 05.10.2026 noch ohne Play-Bericht (LoonPop/FixTheMix
  // im internen Test, Weltgeschichte frisch in Produktion) -> Android "einrichten",
  // bis Google den ersten Monatsbericht ablegt.
  {
    id: "loonpop",
    name: "LoonPop",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6818854983",
    androidPackage: "at.gallab.loonpop",
  },
  {
    id: "fixthemix",
    name: "FixTheMix",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6818787934",
    androidPackage: "at.gallab.fixthemix",
  },
  {
    id: "weltgeschichte",
    name: "Weltgeschichte",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6811862606",
    androidPackage: "de.almaz.weltgeschichte",
  },
  // Laut Diagnose vom 20.11.2026 im App-Store-Connect-Konto und mit Play-Bericht,
  // aber noch ohne Eintrag hier -> standen nur als Android-Zeile "neu" da.
  {
    id: "mountainride",
    name: "Mountain Ride",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6822422299",
    androidPackage: "com.almaz6380.mountainride",
  },
  {
    id: "calcumeter",
    name: "Calcumeter",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6821628971",
    androidPackage: "com.almaz6380.calcumeter",
  },
  {
    id: "tagebuch",
    name: "Daily Journal",
    hasMembers: false,
    stores: ["ios", "android"],
    appleAppId: "6827639812",
    androidPackage: "io.github.almaz6380.tagebuch",
  },
];
