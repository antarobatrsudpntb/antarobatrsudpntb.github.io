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
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    return url.hostname === "script.google.com" || url.hostname === "script.googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com");
  } catch { return false; }
}


let mutationInFlight = 0;
let rpcActive = 0;
const rpcWaiters: Array<() => void> = [];
const CLIENT_NONCE = crypto.randomUUID();
const pending = new Map<string, {
  method: string;
  startedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: number;
  cleanup: () => void;
}>();
let transportListenerInstalled = false;

export type TransportDiagnostics = {
  transport: "FORM_POST_V4";
  endpointConfigured: boolean;
  lastMethod: string;
  lastRoundTripMs: number;
  lastServerMs: number;
  lastOkAt: number;
  lastErrorCode: string;
  lastErrorMessage: string;
  activeRequests: number;
};

const diagnostics: TransportDiagnostics = {
  transport: "FORM_POST_V4",
  endpointConfigured: /^https:\/\/script\.google\.com\/macros\/s\//.test(config.appsScriptUrl),
  lastMethod: "",
  lastRoundTripMs: 0,
  lastServerMs: 0,
  lastOkAt: 0,
  lastErrorCode: "",
  lastErrorMessage: "",
  activeRequests: 0,
};

export function getTransportDiagnostics(): TransportDiagnostics {
  return { ...diagnostics, activeRequests: rpcActive };
}

function rpcError(message: string, code = "API_ERROR", data?: unknown) {
  const error = new Error(String(message || "Permintaan Apps Script gagal.")) as Error & { code?: string; data?: unknown };
  error.code = code;
  error.data = data;
  return error;
}

async function acquireRpcSlot() {
  if (rpcActive < 2) { rpcActive += 1; diagnostics.activeRequests = rpcActive; return; }
  await new Promise<void>((resolve) => rpcWaiters.push(resolve));
  rpcActive += 1;
  diagnostics.activeRequests = rpcActive;
}
function releaseRpcSlot() {
  rpcActive = Math.max(0, rpcActive - 1);
  diagnostics.activeRequests = rpcActive;
  const next = rpcWaiters.shift();
  if (next) next();
}

function finishPending(id: string) {
  const request = pending.get(id);
  if (!request) return null;
  window.clearTimeout(request.timer);
  pending.delete(id);
  request.cleanup();
  return request;
}

function installTransportListener() {
  if (transportListenerInstalled) return;
  transportListenerInstalled = true;
  window.addEventListener("message", (event: MessageEvent<RpcResponse>) => {
    const message = event.data;
    if (!message || message.type !== MESSAGE_TYPE || message.nonce !== CLIENT_NONCE || !message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    if (!googleMessageOrigin(event.origin)) {
      finishPending(message.id);
      diagnostics.lastMethod = request.method;
      diagnostics.lastErrorCode = "UNTRUSTED_RESPONSE_ORIGIN";
      diagnostics.lastErrorMessage = "Respons server berasal dari sumber yang tidak dipercaya.";
      request.reject(rpcError(diagnostics.lastErrorMessage, diagnostics.lastErrorCode));
      return;
    }

    const elapsed = Math.max(0, performance.now() - request.startedAt);
    finishPending(message.id);
    diagnostics.lastMethod = request.method;
    diagnostics.lastRoundTripMs = Math.round(elapsed);
    if (!message.ok) {
      diagnostics.lastErrorCode = String(message.error?.code || "API_ERROR");
      diagnostics.lastErrorMessage = String(message.error?.message || "Permintaan Apps Script gagal.");
      request.reject(rpcError(diagnostics.lastErrorMessage, diagnostics.lastErrorCode, message.error?.data));
      return;
    }

    diagnostics.lastErrorCode = "";
    diagnostics.lastErrorMessage = "";
    diagnostics.lastOkAt = Date.now();
    const result = (message.result || {}) as Record<string, unknown>;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const perf = (result.__perf && typeof result.__perf === "object" ? result.__perf : {}) as Record<string, unknown>;
      diagnostics.lastServerMs = Number(perf.totalServerMs || 0);
      result.__perf = {
        ...perf,
        clientTransport: "FORM_POST_V4",
        transportRoundTripMs: diagnostics.lastRoundTripMs,
      };
    }
    request.resolve(result);
  });
}

/**
 * Stable production transport.
 *
 * This intentionally mirrors the proven pre-Universal MELESAT transport:
 * GitHub Pages -> hidden iframe/form POST -> Apps Script doPost -> HtmlOutput -> window.top.postMessage.
 * No persistent HtmlService bridge is involved in the runtime path.
 */
function stablePostRpc<T>(method: string, data: Record<string, unknown>, authToken = "", timeoutMs = 12_000): Promise<T> {
  ensureConfigured();
  installTransportListener();
  const id = `rpc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const frameName = `melesat_rpc_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const startedAt = performance.now();
  diagnostics.lastMethod = method;

  return new Promise<T>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.name = frameName;
    frame.title = "MELESAT Apps Script RPC";
    frame.style.display = "none";
    frame.setAttribute("aria-hidden", "true");
    document.body.appendChild(frame);

    const form = document.createElement("form");
    form.method = "POST";
    form.action = config.appsScriptUrl;
    form.target = frameName;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "rpc";
    input.value = JSON.stringify({
      type: MESSAGE_TYPE,
      id,
      nonce: CLIENT_NONCE,
      origin: window.location.origin,
      method,
      token: authToken,
      data,
    });
    form.appendChild(input);
    document.body.appendChild(form);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { form.remove(); } catch { /* noop */ }
      try { frame.remove(); } catch { /* noop */ }
    };
    const timer = window.setTimeout(() => {
      pending.delete(id);
      cleanup();
      diagnostics.lastMethod = method;
      diagnostics.lastRoundTripMs = Math.round(Math.max(0, performance.now() - startedAt));
      diagnostics.lastErrorCode = "REQUEST_TIMEOUT";
      diagnostics.lastErrorMessage = `Apps Script belum merespons setelah ${Math.round(timeoutMs / 1000)} detik.`;
      reject(rpcError(diagnostics.lastErrorMessage, diagnostics.lastErrorCode));
    }, timeoutMs);

    pending.set(id, {
      method,
      startedAt,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
      cleanup,
    });

    try {
      form.submit();
      // The form is no longer needed after navigation has been queued; keep the iframe
      // until postMessage arrives because it owns the Apps Script response document.
      window.setTimeout(() => { try { form.remove(); } catch { /* noop */ } }, 0);
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(id);
      cleanup();
      diagnostics.lastErrorCode = "REQUEST_SUBMIT_FAILED";
      diagnostics.lastErrorMessage = error instanceof Error ? error.message : "Gagal mengirim permintaan ke Apps Script.";
      reject(rpcError(diagnostics.lastErrorMessage, diagnostics.lastErrorCode));
    }
  });
}

async function rpc<T = Record<string, unknown>>(method: string, data: Record<string, unknown>, authToken = "", timeoutMs = 12_000): Promise<T> {
  await acquireRpcSlot();
  try { return await stablePostRpc<T>(method, data, authToken, timeoutMs); }
  finally { releaseRpcSlot(); }
}

export async function ping() {
  const authToken = getStoredSession()?.token || "";
  return rpc<Record<string, unknown>>("healthCheck", {}, authToken, 7000);
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
    if (Date.now() - lastChangeAt < 30_000) return 5000 + Math.floor(Math.random() * 700);
    return 6500 + Math.floor(Math.random() * 900);
  };
  const schedule = (delay = nextDelay()) => { window.clearTimeout(timer); if (!stopped) timer = window.setTimeout(check, delay); };

  const check = async () => {
    if (stopped) return;
    if (document.visibilityState !== "visible") return schedule(25_000);
    if (mutationInFlight > 0) return schedule(900 + Math.floor(Math.random() * 400));
    const leader = tryLeader(role);
    if (!leader) return schedule(5000 + Math.floor(Math.random() * 700));
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
