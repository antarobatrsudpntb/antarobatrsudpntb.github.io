const pageUrlArg = process.argv[2] || process.env.PAGE_URL || "";
if (!pageUrlArg) {
  console.error("LIVE SMOKE FAIL: PAGE_URL tidak tersedia.");
  process.exit(1);
}
const pageUrl = new URL(pageUrlArg);
const root = pageUrl.href.endsWith("/") ? pageUrl.href : pageUrl.href + "/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url, options = {}, attempts = 6) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "follow", ...options });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await sleep(3500 + i * 1000);
  }
  throw lastError || new Error("Tidak dapat mengambil resource live.");
}

const cacheBust = `fix4_smoke=${Date.now()}`;
const configUrl = new URL(`melesat-config.js?${cacheBust}`, root).href;
const configText = await fetchText(configUrl);
const match = configText.match(/appsScriptUrl\s*:\s*["']([^"']+)["']/);
if (!match) {
  console.error("LIVE SMOKE FAIL: appsScriptUrl tidak ditemukan di melesat-config.js live.");
  process.exit(1);
}
const endpoint = match[1].trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(endpoint)) {
  if (/GANTI_DENGAN_URL/i.test(endpoint)) {
    console.log("LIVE SMOKE SKIP: appsScriptUrl masih placeholder pada package template.");
    process.exit(0);
  }
  console.error(`LIVE SMOKE FAIL: appsScriptUrl tidak valid: ${endpoint}`);
  process.exit(1);
}

const id = `ci_${Date.now()}`;
const nonce = `ci_nonce_${Date.now()}`;
const rpc = {
  type: "MELESAT_APPS_SCRIPT_RPC_V1",
  id,
  nonce,
  origin: pageUrl.origin,
  method: "healthCheck",
  token: "",
  data: {},
};
const body = new URLSearchParams({ rpc: JSON.stringify(rpc) });
const html = await fetchText(endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
  body,
}, 4);

const checks = [
  [html.includes("window.top.postMessage"), "response memakai window.top.postMessage"],
  [html.includes("</script>"), "response memiliki closing script HTML valid"],
  [!html.includes("<\\/script>"), "response tidak mengirim literal <\\/script>"],
  [html.includes(id), "response mengembalikan request id"],
  [html.includes(nonce), "response mengembalikan nonce"],
  [html.includes('"ok":true'), "healthCheck live sukses"],
  [html.includes("FORM_POST_V4"), "server live memakai transport Fix #4"],
];
const failed = checks.filter(([ok]) => !ok);
checks.forEach(([ok, label]) => console.log(`${ok ? "PASS" : "FAIL"}  ${label}`));
if (failed.length) {
  console.error(`LIVE SMOKE FAIL: ${failed.length} pemeriksaan gagal.`);
  process.exit(1);
}
console.log(`LIVE SMOKE PASS: ${pageUrl.origin} -> Apps Script FORM_POST_V4`);
