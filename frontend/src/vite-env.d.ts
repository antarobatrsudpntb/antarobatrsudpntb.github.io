/// <reference types="vite/client" />

interface Window {
  MELESAT_CONFIG?: {
    backendProvider?: "firebase" | "apps-script";
    appsScriptUrl?: string;
    projectId?: string;
    apiKey?: string;
    region?: string;
    emulator?: boolean | "auto";
    appVersion?: string;
  };
  modelContext?: unknown;
}
