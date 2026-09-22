/*
 * MELESAT Produksi V1
 * Pilih satu backend tanpa mengubah UI/workflow.
 */
window.MELESAT_CONFIG = {
  backendProvider: "apps-script", // "apps-script" | "firebase"
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbyh1wID895-lA6AnkyZsfScn04BRbzYCBumDV44rlKsG0YZ1Zpfve0_Nb6EzWNqQpO9/exec",

  // Hanya dipakai jika backendProvider = "firebase".
  projectId: "GANTI_DENGAN_PROJECT_ID_FIREBASE_RSUD",
  apiKey: "GANTI_DENGAN_WEB_API_KEY_FIREBASE",
  region: "asia-southeast2",
  emulator: false,
  appVersion: "PRODUKSI-V1",
};
