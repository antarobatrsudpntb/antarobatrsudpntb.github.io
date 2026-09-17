import type { AppUser, RealtimeStatus, Role, StoredSessionBase } from "./backend-types";

interface AppsScriptStoredSession extends StoredSessionBase {
  token: string;
  expiresAt: number;
}

type RpcResponse = {
  type?: string;
  id?: string;
  nonce?: string;
  bridgeReady?: boolean;
  bridgeVersion?: string;
  bridgeNonce?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string; data?: unknown };
};

type SignalDelta = {
  domain?: string;
  revision?: number;
  kind?: "UPSERT" | "REMOVE";
  entityType?: "DELIVERY" | "INCIDENT" | "SERVICE_AREA" | "ACCOUNT" | string;
  id?: string;
  record?: Record<string, unknown>;
};

const raw = window.MELESAT_CONFIG || {};
export const config = {
  backendProvider: String(raw.backendProvider || "apps-script").toLowerCase(),
  appsScriptUrl: String(raw.appsScriptUrl || ""),
  appVersion: String(raw.appVersion || "1.0.0"),
};

const KEY = "melesat.session.v1.apps-script";
const MESSAGE_TYPE = "MELESAT_APPS_SCRIPT_RPC_V1";
const MUTATION_METHODS = new Set([
  "addDelivery", "pharmacyUpdateWaitingDelivery", "markReady", "claimTask", "setDeliveryPending",
  "resumeDelivery", "completeTaskVerified", "failDelivery", "confirmReturnToPharmacy",
  "failedFollowUpWhatsApp", "planRedelivery", "createRedelivery", "scheduleRedelivery", "markSelfPickup", "confirmSelfPickup",
  "closeFailedCase", "manualVerifyReceipt", "reportCourierIncident", "resolveCourierIncident",
  "adminVerifyCourierIncident", "verifyCourierIncident", "adminCorrectStatus",
]);

function ensureConfigured() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(config.appsScriptUrl)) {
    throw new Error("URL Web App Apps Script belum dikonfigurasi pada melesat-config.js.");
  }
}

function saveSession(session: AppsScriptStoredSession) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  const current = getStoredSession();
  sessionStorage.removeItem(KEY);
  if (current?.token) void rpc("logout", {}, current.token, 7000).catch(() => undefined);
}

export function getStoredSession(): AppsScriptStoredSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null") as AppsScriptStoredSession | null;
    if (!value || !value.token || value.sessionEndsAt <= Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return value;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

function token() {
  const session = getStoredSession();
  if (!session) throw new Error("Sesi tidak tersedia. Silakan masuk kembali.");
  return session.token;
}

function googleMessageOrigin(origin: string) {
  return origin === "null" ||
    /^https:\/\/script\.google\.com$/.test(origin) ||
    /^https:\/\/script\.googleusercontent\.com$/.test(origin) ||
    /^https:\/\/[^/]+\.googleusercontent\.com$/.test(origin);
}

let bridgeFrame: HTMLIFrameElement | null = null;
let bridgeIsReady = false;
let bridgeReadyPromise: Promise<void> | null = null;
let bridgeFailedUntil = 0;
let bridgeNonce = "";
const BRIDGE_WARMUP_TIMEOUT_MS = 1500;
const BRIDGE_RETRY_COOLDOWN_MS = 10_000;
const bridgePending = new Map<string, { nonce: string; resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: number }>();
let bridgeListenerInstalled = false;
let mutationInFlight = 0;
let rpcActive = 0;
const rpcWaiters: Array<() => void> = [];
async function acquireRpcSlot() {
  if (rpcActive < 2) { rpcActive += 1; return; }
  await new Promise<void>((resolve) => rpcWaiters.push(resolve));
  rpcActive += 1;
}
function releaseRpcSlot() {
  rpcActive = Math.max(0, rpcActive - 1);
  const next = rpcWaiters.shift(); if (next) next();
}

function bridgeTransportError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function installBridgeListener() {
  if (bridgeListenerInstalled) return;
  bridgeListenerInstalled = true;
  window.addEventListener("message", (event: MessageEvent<RpcResponse>) => {
    if (!googleMessageOrigin(event.origin)) return;
    const message = event.data;
    if (!message || message.type !== MESSAGE_TYPE || message.bridgeNonce !== bridgeNonce) return;
    if (message.bridgeReady) {
      bridgeIsReady = true;
      window.dispatchEvent(new CustomEvent("melesat:bridge-ready", { detail: { version: message.bridgeVersion || "3.1", nonce: message.bridgeNonce } }));
      return;
    }
    if (!message.id || !message.nonce) return;
    const pending = bridgePending.get(message.id);
    if (!pending || pending.nonce !== message.nonce) return;
    window.clearTimeout(pending.timer);
    bridgePending.delete(message.id);
    if (!message.ok) {
      const error = new Error(message.error?.message || "Permintaan Apps Script gagal.");
      (error as Error & { code?: string; data?: unknown }).code = message.error?.code;
      (error as Error & { data?: unknown }).data = message.error?.data;
      pending.reject(error);
    } else pending.resolve(message.result || {});
  });
}

function bridgeUrl(nonce: string) {
  const separator = config.appsScriptUrl.includes("?") ? "&" : "?";
  return `${config.appsScriptUrl}${separator}bridge=1&origin=${encodeURIComponent(window.location.origin)}&bridgeNonce=${encodeURIComponent(nonce)}`;
}

function invalidateBridge(cooldownMs = BRIDGE_RETRY_COOLDOWN_MS) {
  bridgeIsReady = false;
  bridgeReadyPromise = null;
  bridgeFailedUntil = Date.now() + cooldownMs;
  const oldFrame = bridgeFrame;
  bridgeFrame = null;
  bridgeNonce = "";
  try { oldFrame?.remove(); } catch { /* noop */ }
  window.setTimeout(() => { void startBridgeWarmup().catch(() => undefined); }, cooldownMs + 50);
}

function startBridgeWarmup(timeoutMs = BRIDGE_WARMUP_TIMEOUT_MS): Promise<void> {
  ensureConfigured();
  if (bridgeIsReady && bridgeFrame?.isConnected) return Promise.resolve();
  if (bridgeReadyPromise) return bridgeReadyPromise;
  if (Date.now() < bridgeFailedUntil) return Promise.reject(bridgeTransportError("Bridge sedang fallback.", "BRIDGE_COOLDOWN"));
  installBridgeListener();

  const nonce = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "MELESAT Apps Script Bridge");
  frame.src = bridgeUrl(nonce);
  bridgeFrame?.remove();
  bridgeFrame = frame;
  bridgeNonce = nonce;
  bridgeIsReady = false;

  bridgeReadyPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("melesat:bridge-ready", onReady as EventListener);
    };
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ nonce?: string }>).detail;
      if (detail?.nonce !== nonce) return;
      cleanup();
      bridgeReadyPromise = null;
      bridgeFailedUntil = 0;
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      if (bridgeNonce === nonce) invalidateBridge();
      reject(bridgeTransportError("Persistent bridge belum siap.", "BRIDGE_WARMUP_TIMEOUT"));
    }, timeoutMs);
    window.addEventListener("melesat:bridge-ready", onReady as EventListener);
  });
  document.body.appendChild(frame);
  return bridgeReadyPromise;
}

function scheduleBridgeWarmup() {
  const start = () => { void startBridgeWarmup().catch(() => undefined); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else window.setTimeout(start, 0);
}

function bridgeRpc<T>(method: string, data: Record<string, unknown>, authToken: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!bridgeIsReady || !bridgeFrame?.contentWindow || !bridgeNonce) {
      reject(bridgeTransportError("Bridge Apps Script belum siap.", "BRIDGE_UNAVAILABLE"));
      return;
    }
    const id = `rpc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const nonce = crypto.randomUUID();
    const activeBridgeNonce = bridgeNonce;
    const timer = window.setTimeout(() => {
      bridgePending.delete(id);
      if (bridgeNonce === activeBridgeNonce) invalidateBridge(3000);
      reject(bridgeTransportError("Apps Script bridge tidak merespons dalam batas waktu.", "BRIDGE_TIMEOUT"));
    }, timeoutMs);
    bridgePending.set(id, { nonce, resolve: resolve as (value: unknown) => void, reject, timer });
    bridgeFrame.contentWindow.postMessage({ type: MESSAGE_TYPE, id, nonce, bridgeNonce: activeBridgeNonce, origin: window.location.origin, method, token: authToken, data }, "*");
  });
}

function legacyRpc<T>(method: string, data: Record<string, unknown>, authToken = "", timeoutMs = 25_000): Promise<T> {
  ensureConfigured();
  return new Promise<T>((resolve, reject) => {
    const id = `rpc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const nonce = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.name = `melesat_rpc_${id}`;
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    const form = document.createElement("form");
    form.method = "POST"; form.action = config.appsScriptUrl; form.target = iframe.name; form.hidden = true;
    const input = document.createElement("input");
    input.type = "hidden"; input.name = "rpc";
    input.value = JSON.stringify({ type: MESSAGE_TYPE, id, nonce, origin: window.location.origin, method, token: authToken, data });
    form.appendChild(input);
    let done = false;
    const cleanup = () => { if (done) return; done = true; window.clearTimeout(timer); window.removeEventListener("message", onMessage); form.remove(); window.setTimeout(() => iframe.remove(), 0); };
    const onMessage = (event: MessageEvent<RpcResponse>) => {
      const message = event.data;
      if (!googleMessageOrigin(event.origin) || !message || message.type !== MESSAGE_TYPE || message.id !== id || message.nonce !== nonce) return;
      cleanup();
      if (!message.ok) {
        const error = new Error(message.error?.message || "Permintaan Apps Script gagal.");
        (error as Error & { code?: string; data?: unknown }).code = message.error?.code;
        (error as Error & { data?: unknown }).data = message.error?.data;
        reject(error);
      } else resolve((message.result || {}) as T);
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Apps Script tidak merespons dalam batas waktu.")); }, timeoutMs);
    window.addEventListener("message", onMessage); document.body.appendChild(iframe); document.body.appendChild(form); form.submit();
  });
}

const BRIDGE_TRANSPORT_CODES = new Set(["BRIDGE_UNAVAILABLE", "BRIDGE_TIMEOUT", "BRIDGE_INVOCATION_ERROR", "BRIDGE_WARMUP_TIMEOUT", "BRIDGE_COOLDOWN", "BRIDGE_ERROR"]);

async function rpc<T = Record<string, unknown>>(method: string, data: Record<string, unknown>, authToken = "", timeoutMs = 12_000): Promise<T> {
  await acquireRpcSlot();
  try {
    // Warm the persistent bridge in the background. A cold/failed bridge must never
    // delay the current action: use the proven legacy POST transport immediately.
    void startBridgeWarmup().catch(() => undefined);
    if (bridgeIsReady) {
      try { return await bridgeRpc<T>(method, data, authToken, timeoutMs); }
      catch (error) {
        const code = String((error as Error & { code?: string })?.code || "");
        if (!BRIDGE_TRANSPORT_CODES.has(code)) throw error;
      }
    }
    return legacyRpc<T>(method, data, authToken, timeoutMs);
  } finally { releaseRpcSlot(); }
}

scheduleBridgeWarmup();

function firstSuccessful<T>(attempts: Array<Promise<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let failed = 0;
    let lastError: unknown = null;
    attempts.forEach((attempt) => {
      attempt.then(resolve).catch((error) => {
        failed += 1;
        lastError = error;
        if (failed >= attempts.length) reject(lastError instanceof Error ? lastError : new Error("Layanan Apps Script belum merespons."));
      });
    });
  });
}

export async function ping() {
  const authToken = getStoredSession()?.token || "";
  // Health check is read-only, so it is safe to race both transports. This avoids
  // a false offline state while the persistent Apps Script bridge is still warming.
  const bridgeAttempt = (async () => {
    await startBridgeWarmup(2500);
    return bridgeRpc<Record<string, unknown>>("healthCheck", {}, authToken, 5000);
  })();
  const legacyAttempt = legacyRpc<Record<string, unknown>>("healthCheck", {}, authToken, 7000);
  return firstSuccessful([bridgeAttempt, legacyAttempt]);
}

export async function login(username: string, pin: string): Promise<AppUser> {
  const result = await rpc<{ token: string; session?: { maxAgeSeconds?: number; expiresAt?: string }; user: AppUser }>("loginWithPin", { username: username.trim(), pin }, "", 12_000);
  if (!result.token || !result.user) throw new Error("Server tidak mengembalikan sesi login yang valid.");
  const maxAge = Number(result.session?.maxAgeSeconds || 21_600);
  saveSession({ token: result.token, expiresAt: Date.now() + maxAge * 1000, sessionEndsAt: Date.now() + maxAge * 1000, user: result.user });
  return result.user;
}

function sleep(ms: number) { return new Promise<void>((resolve) => window.setTimeout(resolve, ms)); }

export async function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const mutation = MUTATION_METHODS.has(name), attempts = mutation ? 4 : 1;
  let lastError: unknown = null;
  if (mutation) mutationInFlight += 1;
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await rpc<T>(name, data, token(), mutation ? 8_000 : 18_000);
        if (mutation) window.dispatchEvent(new CustomEvent("melesat:local-mutation", { detail: { method: name, at: Date.now() } }));
        return result;
      } catch (error) {
        lastError = error;
        const code = String((error as Error & { code?: string })?.code || "");
        if (!mutation || !["SERVER_BUSY", "MUTATION_IN_PROGRESS"].includes(code) || attempt >= attempts - 1) throw error;
        await sleep(160 + Math.floor(Math.random() * 220) + attempt * 180);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Permintaan gagal.");
  } finally { if (mutation) mutationInFlight = Math.max(0, mutationInFlight - 1); }
}

export function requestId(prefix = "web") { return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`; }
export function isEmulator() { return false; }

function interactionBusy() {
  if (document.documentElement.classList.contains("melesat-interaction-busy")) return true;
  const active = document.activeElement as HTMLElement | null;
  const tag = active?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || active?.isContentEditable) return true;
  return Boolean(document.querySelector(".modal-layer"));
}
function emitPending(pending: boolean) { window.dispatchEvent(new CustomEvent("melesat:update-pending", { detail: { pending } })); }
function emitDeltas(deltas: SignalDelta[]) { if (deltas.length) window.dispatchEvent(new CustomEvent("melesat:remote-delta", { detail: { deltas } })); }

const TAB_ID = crypto.randomUUID();
function leaderKey(role: Role) { return `melesat.poll.leader.${role}`; }
function tryLeader(role: Role) {
  const key = leaderKey(role), now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null") as { id?: string; expiresAt?: number } | null;
    if (!current || !current.id || Number(current.expiresAt || 0) < now || current.id === TAB_ID) {
      localStorage.setItem(key, JSON.stringify({ id: TAB_ID, expiresAt: now + 12_000 }));
      return true;
    }
  } catch { return true; }
  return false;
}
function renewLeader(role: Role) { try { localStorage.setItem(leaderKey(role), JSON.stringify({ id: TAB_ID, expiresAt: Date.now() + 12_000 })); } catch { /* noop */ } }
function releaseLeader(role: Role) { try { const x = JSON.parse(localStorage.getItem(leaderKey(role)) || "null"); if (x?.id === TAB_ID) localStorage.removeItem(leaderKey(role)); } catch { /* noop */ } }

export async function subscribeWorkspaceSignals(role: Role, onChange: () => void, onStatus: (status: RealtimeStatus) => void): Promise<() => void> {
  let stopped = false, timer = 0, signature = "", pending = false, lastChangeAt = Date.now();
  let revisions: Record<string, number> = {};
  let pendingDeltas: SignalDelta[] = [];
  let pendingResync = false;
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(`melesat-signal-${role}`); } catch { channel = null; }

  const applySignal = (result: { signature?: string; revisions?: Record<string, number>; deltas?: SignalDelta[]; resyncRequired?: boolean }) => {
    const next = String(result.signature || "");
    const changed = Boolean(signature && next && next !== signature);
    if (next) signature = next;
    if (result.revisions) revisions = result.revisions;
    if (changed) lastChangeAt = Date.now();
    const deltas = Array.isArray(result.deltas) ? result.deltas : [];
    if (changed && interactionBusy()) {
      pending = true; pendingDeltas.push(...deltas); pendingResync = pendingResync || Boolean(result.resyncRequired); emitPending(true);
      return;
    }
    if (pendingDeltas.length && !interactionBusy()) { emitDeltas(pendingDeltas); pendingDeltas = []; }
    if (deltas.length) emitDeltas(deltas);
    if ((pendingResync || (result.resyncRequired && changed)) && !interactionBusy()) { pendingResync = false; onChange(); }
    pending = false; emitPending(false);
  };

  if (channel) channel.onmessage = (event) => { if (!stopped && event.data?.type === "signal") { applySignal(event.data.payload || {}); onStatus("live"); } };

  const nextDelay = () => {
    if (document.visibilityState !== "visible") return 25_000;
    if (Date.now() - lastChangeAt < 30_000) return 3000 + Math.floor(Math.random() * 700);
    return 5000 + Math.floor(Math.random() * 900);
  };
  const schedule = (delay = nextDelay()) => { window.clearTimeout(timer); if (!stopped) timer = window.setTimeout(check, delay); };

  const check = async () => {
    if (stopped) return;
    if (document.visibilityState !== "visible") return schedule(25_000);
    if (mutationInFlight > 0) return schedule(900 + Math.floor(Math.random() * 400));
    const leader = tryLeader(role);
    if (!leader) return schedule(3000 + Math.floor(Math.random() * 700));
    renewLeader(role);
    onStatus(signature ? "live" : "connecting");
    try {
      const result = await callFunction<{ signature: string; revisions: Record<string, number>; deltas?: SignalDelta[]; resyncRequired?: boolean }>("workspaceSignals", { role, revisions });
      applySignal(result);
      channel?.postMessage({ type: "signal", payload: result });
      onStatus("live");
      schedule();
    } catch { onStatus("offline"); schedule(7000 + Math.floor(Math.random() * 1500)); }
  };

  const onVisibility = () => { window.clearTimeout(timer); if (document.visibilityState === "visible") { if (pending && !interactionBusy()) { pending = false; emitPending(false); if (pendingDeltas.length) { emitDeltas(pendingDeltas); pendingDeltas = []; } if (pendingResync) { pendingResync = false; onChange(); } } void check(); } else schedule(25_000); };
  const onFocusOut = () => window.setTimeout(() => { if (pending && !interactionBusy()) { pending = false; emitPending(false); if (pendingDeltas.length) { emitDeltas(pendingDeltas); pendingDeltas = []; } if (pendingResync) { pendingResync = false; onChange(); } } }, 80);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("focusout", onFocusOut, true);
  onStatus("connecting"); void check();

  return () => {
    stopped = true; window.clearTimeout(timer); emitPending(false); releaseLeader(role);
    document.removeEventListener("visibilitychange", onVisibility); document.removeEventListener("focusout", onFocusOut, true);
    channel?.close();
  };
}
