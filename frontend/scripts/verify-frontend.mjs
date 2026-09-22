import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [], failures = [], notes = [];
const check = (condition, label) => { checks.push(label); if (!condition) failures.push(label); };
const read = (f) => readFileSync(join(root, f), "utf8");
const requiredSource = [
  "src/App.tsx", "src/lib/backend.ts", "src/lib/apps-script-rest.ts", "src/lib/firebase-rest.ts", "src/lib/backend-types.ts", "src/lib/fast-v2-ui.ts", "src/lib/wa-policy.ts",
  "public/service-worker.js", "public/melesat-config.js", "public/manifest.webmanifest", "scripts/live-transport-smoke.mjs"
];
for (const f of requiredSource) check(existsSync(join(root, f)), `source tersedia: ${f}`);

const backend = read("src/lib/backend.ts");
const gas = read("src/lib/apps-script-rest.ts");
const fb = read("src/lib/firebase-rest.ts");
const app = read("src/App.tsx");
const ui = read("src/lib/fast-v2-ui.ts");
const wa = read("src/lib/wa-policy.ts");
const sw = read("public/service-worker.js");

check(backend.includes('import("./firebase-rest")'), "Firebase di-lazy import dari backend provider");
check(!backend.includes('import * as firebase from "./firebase-rest"'), "Firebase tidak masuk static initial Apps Script chunk");
check(["login", "callFunction", "ping", "subscribeWorkspaceSignals"].every(x => backend.includes(`function ${x}`)), "provider contract utama tersedia");
check(gas.includes("FORM_POST_V4") && gas.includes('form.method = "POST"') && gas.includes('addEventListener("message"') && gas.includes("CLIENT_NONCE"), "FORM_POST_V4 hidden form + nonce/message validation dipertahankan");
check(!gas.includes("bridgeFrame") && !gas.includes("startBridgeWarmup") && !gas.includes("bridgeRpc"), "persistent bridge tidak kembali");
check(gas.includes("ACK_SLOW_MS") && gas.includes("reconcileReceipt") && gas.includes("mutationReceipt"), "Reliable acknowledgement + receipt reconcile aktif");
check(gas.includes("2_850") && gas.includes("16_000") && gas.includes("Math.random()") && gas.includes("BroadcastChannel"), "signal realtime aktif ~3 detik + jitter, background ~16–20 detik");
check(gas.includes("mutationInFlight > 0") && gas.includes("interactionBusy()") && gas.includes("melesat:update-pending"), "polling yield saat mutation/form aktif");
check(gas.includes("transportRoundTripMs"), "diagnostik transportRoundTripMs tersedia");
check(ui.includes("Sedang diproses…") && ui.includes("Sedang menyelesaikan proses. Jangan ulangi tindakan."), "loading anti-double-click menggunakan bahasa LOCK");
check(ui.includes("melesat-interaction-busy") && app.includes("useInteractionGuard(busy)"), "interaction guard global aktif");
check(app.includes("mergeVersioned") && app.includes("incomingVersion < currentVersion"), "anti-stale record version aktif");
check(app.includes("Data baru tersedia") && app.includes("melesat:update-pending"), "realtime tidak memaksa reset form/modal");
check(app.includes("ensurePharmacyAreas") && app.includes('active === "register"'), "master 623 wilayah dimuat lazy saat dibutuhkan");
check(app.includes('const activeForRefresh = user.role === "ADMIN" ? active : ""'), "pindah tab Farmasi/Kurir tidak memicu full workspace reload");
check(!app.includes('from "recharts"') && !app.includes("from 'recharts'"), "Recharts tidak masuk initial App chunk");
check(app.includes("Layanan Berjalan Normal") && app.includes("Ada Pengaturan yang Perlu Ditinjau") && app.includes("Layanan Dihentikan Sementara"), "Admin memakai tiga status operasional awam");
check(app.includes("Mode Teknisi Lanjutan"), "detail teknis tetap di Mode Teknisi");
check(app.includes("Buka/Kirim Ulang WA"), "WA event lama dapat dibuka/kirim ulang eksplisit");
check(wa.includes("REGISTER") && wa.includes("PENDING") && wa.includes("FAILED") && wa.includes("FOLLOWUP") && wa.includes("REDELIVERY") && wa.includes("MANUAL_VERIFICATION"), "WA policy memuat whitelist final");
check(!/waPreparedAt|waOpenedAt|resendOpenCount|lastOpenedAt/.test(wa + gas + app), "tidak ada audit click-to-chat detail yang menambah hot path");
check(app.includes("Pengantaran ke-") || app.includes("PENGANTARAN KE-"), "indikator attempt pengantaran tersedia");
check(app.includes("Cetak / Simpan PDF") && !app.includes("Unduh CSV"), "laporan memakai print/PDF tanpa CSV");
check(!/window\.(prompt|confirm|alert)\s*\(/.test(app), "workflow frontend bebas dialog native browser");
check(sw.includes("v1.1.2-golden-hardening") && sw.includes('event.request.method !== "GET"') && sw.includes("url.origin !== self.location.origin"), "service worker golden-hardening versioned dan hanya cache GET same-origin");
check(fb.includes("onSnapshot") && fb.includes("workspaceSignals"), "Firebase compatibility/realtime reference tetap tersedia");
check(!app.includes('label="Nama calon penerima"') && !app.includes('label="Patokan"') && app.includes('Catatan alamat untuk Kurir (opsional)'), "form pendaftaran dipangkas: penerima/patokan hilang, satu catatan Kurir opsional");
check(app.includes('Detail (opsional)') && app.includes('Catatan penyelesaian (opsional)') && app.includes('KENDALA AKTIF'), "kendala menjadi informasi ringan tanpa verifikasi wajib");
check(app.includes('Total tarif layanan') && app.includes('Komposisi Layanan Berdasarkan Pembiayaan') && app.includes('Berbayar penuh'), "bahasa pembiayaan Manajemen diperjelas");
check(app.includes('Pengantaran ke-') && !app.includes('>Attempt<') && !app.includes('label="Attempt"') && !app.includes('title="Attempt"'), "istilah Attempt tidak ditampilkan sebagai label UI");
check(app.includes('get(health, "adminActionRequired") === true') && app.includes('Layanan Berjalan Normal'), "status Admin normal tidak dipicu warning teknis");


const dist = join(root, "dist");
if (existsSync(dist)) {
  const requiredDist = ["index.html", "melesat-config.js", "manifest.webmanifest", "service-worker.js"];
  for (const f of requiredDist) check(existsSync(join(dist, f)), `build tersedia: dist/${f}`);
  const assetsDir = join(dist, "assets");
  if (existsSync(assetsDir)) {
    const js = readdirSync(assetsDir).filter(f => f.endsWith(".js"));
    const sizes = js.map(f => ({f, raw: statSync(join(assetsDir,f)).size, gzip: gzipSync(readFileSync(join(assetsDir,f))).length})).sort((a,b)=>b.raw-a.raw);
    const totalGzip = sizes.reduce((n,x)=>n+x.gzip,0);
    notes.push(`dist JS gzip total: ${Math.round(totalGzip/1024)} KB (${sizes.length} chunks)`);
    check(totalGzip < 365 * 1024, "bundle JS gzip tidak kembali ke baseline lama ~365 KB");
    if (totalGzip >= 200 * 1024) notes.push("NOTE: target ideal initial gzip <200 KB belum dapat dipastikan dari total semua chunks; cek initial graph di build report.");
  }
} else {
  notes.push("dist belum tersedia di packaging container; full Vite build dijalankan oleh GitHub Actions setelah push/deploy.");
}

for (const n of notes) console.log(n);
if (failures.length) {
  failures.forEach(x => console.error(`FAIL  ${x}`));
  console.error(`SUMMARY: ${checks.length - failures.length} PASS / ${failures.length} FAIL`);
  process.exit(1);
}
checks.forEach(x => console.log(`PASS  ${x}`));
console.log(`SUMMARY: ${checks.length} PASS / 0 FAIL`);
