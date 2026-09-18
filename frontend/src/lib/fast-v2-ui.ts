/**
 * Global processing overlay for FAST COMMIT V2.
 * It is driven by lifecycle events emitted by the provider, so even actions whose local modal/card
 * has not re-rendered yet receive visible acknowledgement immediately.
 */
let activeCount = 0;
let installed = false;
let overlay: HTMLDivElement | null = null;
let text: HTMLSpanElement | null = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "melesat-fast-v2-processing";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = '<div class="melesat-fast-v2-processing__card"><i aria-hidden="true"></i><span>Sedang diproses…</span></div>';
  text = overlay.querySelector("span");
  document.body.appendChild(overlay);
  return overlay;
}

function show(message = "Sedang diproses…") {
  const node = ensureOverlay();
  if (text) text.textContent = message;
  node.dataset.visible = "true";
  document.documentElement.classList.add("melesat-interaction-busy");
}
function hide() {
  if (overlay) overlay.dataset.visible = "false";
  if (activeCount <= 0) document.documentElement.classList.remove("melesat-interaction-busy");
}

export function installFastV2UiFeedback() {
  if (installed) return;
  installed = true;
  ensureOverlay();
  window.addEventListener("melesat:operation-start", (event) => {
    activeCount += 1;
    const detail = (event as CustomEvent<{ label?: string }>).detail || {};
    show(detail.label || "Sedang diproses…");
  });
  window.addEventListener("melesat:operation-slow", () => {
    show("Sedang menyelesaikan proses. Jangan ulangi tindakan.");
  });
  window.addEventListener("melesat:operation-end", () => {
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) hide();
  });
}
