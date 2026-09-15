import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [], failures = [];
const check = (condition, label) => { checks.push(label); if (!condition) failures.push(label); };
const required = [
  "dist/index.html", "dist/melesat-config.js", "dist/manifest.webmanifest", "dist/service-worker.js",
  "dist/assets/logo-rsud-ntb.webp", "dist/assets/maskot-melesat.png", "dist/assets/icon-192.png", "dist/assets/icon-512.png",
  "src/lib/backend.ts", "src/lib/apps-script-rest.ts", "src/lib/firebase-rest.ts", "src/lib/backend-types.ts",
];
for (const f of required) check(existsSync(join(root, f)), `file tersedia: ${f}`);
if (failures.length === 0) {
  const html = readFileSync(join(root, "dist/index.html"), "utf8");
  check(html.includes("manifest.webmanifest") && html.includes("melesat-config.js"), "build memuat manifest dan runtime config");
  const config = readFileSync(join(root, "dist/melesat-config.js"), "utf8");
  check(config.includes("backendProvider") && config.includes("appsScriptUrl") && config.includes("projectId"), "runtime config mendukung dua provider");
  check(!/private[_-]?key|client[_-]?secret|pinPepper|receipt[_-]?key/i.test(config), "runtime config publik tidak membawa secret server");
}
const backend = readFileSync(join(root, "src/lib/backend.ts"), "utf8");
const gas = readFileSync(join(root, "src/lib/apps-script-rest.ts"), "utf8");
const fb = readFileSync(join(root, "src/lib/firebase-rest.ts"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
check(backend.includes('backendProvider === "apps-script" ? appsScript : firebase'), "Golden Frontend memilih provider tanpa fork UI");
check(["login", "callFunction", "ping", "subscribeWorkspaceSignals"].every(x => backend.includes(`function ${x}`)), "provider contract utama tersedia");
check(gas.includes("workspaceSignals") && gas.includes("document.visibilityState") && gas.includes("interactionBusy") && gas.includes("melesat:update-pending"), "Apps Script memakai adaptive revision polling aman terhadap form");
check(gas.includes("12_000") && gas.includes("30_000") && gas.includes("45_000"), "profil polling role-aware tersedia");
check(gas.includes("iframe") && gas.includes('addEventListener("message"') && gas.includes("nonce"), "Apps Script RPC memakai iframe/message listener + nonce");
check(fb.includes("onSnapshot") && fb.includes("workspaceSignals"), "Firebase tetap memakai realtime workspace signal");
check(app.includes("Data baru tersedia") && app.includes("melesat:update-pending"), "UI memberi notifikasi perubahan tanpa menghapus input");
check(app.includes("Master Wilayah Pulau Lombok") && app.includes("regency-folders"), "Master 623 dikelompokkan per kabupaten/kota");
check(!app.includes("Tambah Desa/Kelurahan"), "Golden Master wilayah tidak dapat ditambah dari UI");
check(["DELIVERIES", "attempt"].some(() => app.includes("Tindak Lanjut")) && app.includes("Aktifkan Antar Ke-2"), "workflow attempt kedua tersedia");
check(app.includes("Cetak / Simpan PDF") && !app.includes("Unduh CSV"), "laporan memakai print/PDF tanpa CSV");
check(app.includes("Annual Cleanup") && app.includes("SETUJUI CLEANUP"), "annual cleanup memakai typed approval");
check(app.includes("Mode Teknisi Lanjutan") && app.includes("enterTechnicianMode"), "Mode Teknisi Lanjutan tersedia");
check(!/window\.(prompt|confirm|alert)\s*\(/.test(app), "workflow frontend bebas dialog native browser");
const sw = readFileSync(join(root, "public/service-worker.js"), "utf8");
check(sw.includes('event.request.method !== "GET"') && sw.includes("url.origin !== self.location.origin"), "service worker hanya cache GET same-origin");

if (failures.length) {
  failures.forEach(x => console.error(`FAIL  ${x}`));
  console.error(`SUMMARY: ${checks.length - failures.length} PASS / ${failures.length} FAIL`);
  process.exit(1);
}
checks.forEach(x => console.log(`PASS  ${x}`));
console.log(`SUMMARY: ${checks.length} PASS / 0 FAIL`);
