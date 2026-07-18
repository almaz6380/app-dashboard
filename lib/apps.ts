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
    stores: ["ios"],
    appleAppId: "6781266042",
  },
  {
    id: "mypeak",
    name: "MyPeak",
    hasMembers: true,
    membersEnv: {
      urlVar: "MYPEAK_SUPABASE_URL",
      keyVar: "MYPEAK_SUPABASE_SERVICE_KEY",
      table: "profiles",
    },
    stores: ["ios", "android"],
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
    name: "Mahjong",
    hasMembers: false, // rein offline, keine Konten
    stores: ["ios", "android"],
    androidPackage: "com.mahjongroyale.app",
  },
];
