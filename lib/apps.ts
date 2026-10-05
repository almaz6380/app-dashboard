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
  // Nur im App Store (Stand 05.10.2026 kein Play-Bericht). Gefunden per
  // Diagnose "Apps im Konto" (scripts/apple-instanzen.mjs).
  {
    id: "loonpop",
    name: "LoonPop",
    hasMembers: false,
    stores: ["ios"],
    appleAppId: "6818854983",
  },
  {
    id: "fixthemix",
    name: "FixTheMix",
    hasMembers: false,
    stores: ["ios"],
    appleAppId: "6818787934",
  },
  {
    id: "weltgeschichte",
    name: "Weltgeschichte",
    hasMembers: false,
    stores: ["ios"],
    appleAppId: "6811862606",
  },
];
