/*
 * MELESAT Universal Frontend v1.0.0
 * Pilih satu backend tanpa mengubah UI/workflow.
 */
window.MELESAT_CONFIG = {
  backendProvider: "apps-script", // "apps-script" | "firebase"
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbyFNboHxNNwCYzpYWlcMWo2n8UIzJveyeJ_XflWGGQasSq74rY5M0OYfo-tIk8b1Yfu/exec",

  // Hanya dipakai jika backendProvider = "firebase".
  projectId: "GANTI_DENGAN_PROJECT_ID_FIREBASE_RSUD",
  apiKey: "GANTI_DENGAN_WEB_API_KEY_FIREBASE",
  region: "asia-southeast2",
  emulator: false,
  appVersion: "1.0.0",
};
