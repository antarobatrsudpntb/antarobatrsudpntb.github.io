import type { AppUser, RealtimeStatus, Role, StoredSessionBase } from "./backend-types";

interface AppsScriptStoredSession extends StoredSessionBase {
  token: string;
  expiresAt: number;
}

type RpcResponse = {
  type?: string;
  id?: string;
  nonce?: string;
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

type ReceiptState = "PROCESSING" | "COMMITTED" | "FAILED" | "UNKNOWN";
type MutationReceipt = {
  requestId?: string;
  entityId?: string;
  action?: string;
  status?: ReceiptState;
  resultVersion?: number;
  committedAt?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

type PerfRecord = {
  totalServerMs?: number;
  authMs?: number;
  indexMs?: number;
  lockWaitMs?: number;
  sheetReadMs?: number;
  sheetWriteMs?: number;
  journalMs?: number;
  auditMs?: number;
  criticalMs?: number;
  transportRoundTripMs?: number;
  clientTransport?: string;
};

const raw = window.MELESAT_CONFIG || {};
export const config = {
  backendProvider: String(raw.backendProvider || "apps-script").toLowerCase(),
  appsScriptUrl: String(raw.appsScriptUrl || ""),
  appVersion: String(raw.appVersion || "PRODUKSI-V1"),
};

const KEY = "melesat.session.v1.apps-script";
const MESSAGE_TYPE = "MELESAT_APPS_SCRIPT_RPC_V1";
const CLIENT_NONCE = crypto.randomUUID();
const ACK_SLOW_MS = 4_000;
const MUTATION_TRANSPORT_TIMEOUT_MS = 8_000;
const RECEIPT_RECONCILE_BUDGET_MS = 20_000;
const RECEIPT_POLL_MS = 700;

const MUTATION_METHODS = new Set([
  "addDelivery", "pharmacyUpdateWaitingDelivery", "markReady", "claimTask", "setDeliveryPending",
  "resumeDelivery", "completeTaskVerified", "failDelivery", "confirmReturnToPharmacy",
  "planRedelivery", "createRedelivery", "scheduleRedelivery", "markSelfPickup", "confirmSelfPickup",
  "closeFailedCase", "manualVerifyReceipt", "reportCourierIncident", "resolveCourierIncident",
  "adminVerifyCourierIncident", "verifyCourierIncident", "adminCorrectStatus",
  "adminAccountCreate", "adminAccountUpdate", "adminAccountChangePin", "adminAccountStorePin",
  "adminServiceAreaUpsert", "adminServiceAreasBulkUpdate", "adminOperationalSettingsUpdate",
  "adminCreateBackup", "adminRunArchiveSync", "adminPrepareCleanup", "adminApproveCleanup", "adminRunCleanupBatch",
  "technicianRestoreBackup", "technicianRestoreCheckpoint", "technicianRecoverTransaction",
  "technicianRestoreCell", "repairSafeStructure",
]);

/**
 * WA V2 is a closed whitelist. The frontend also strips accidental legacy waAction payloads
 * from non-whitelisted methods so old backend behavior cannot re-introduce WA spam.
 */
const WA_RESULT_METHODS = new Set([
  "prepareWhatsApp",
  "pharmacyRegistrationWaAction",
  "failedFollowUpWhatsApp",
  "getManualReceiptConfirmationWaAction",
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
  if (current?.token) void rpc("logout", {}, current.token, 7_000).catch(() => undefined);
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
  lastPerf: PerfRecord;
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
  lastPerf: {},
};

export function getTransportDiagnostics(): TransportDiagnostics {
  return { ...diagnostics, lastPerf: { ...diagnostics.lastPerf }, activeRequests: rpcActive };
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

function mergePerf(result: Record<string, unknown>, elapsed: number) {
  const perf = (result.__perf && typeof result.__perf === "object" ? result.__perf : {}) as PerfRecord;
  const merged: PerfRecord = {
    totalServerMs: Number(perf.totalServerMs || 0),
    authMs: Number(perf.authMs || 0),
    indexMs: Number(perf.indexMs || 0),
    lockWaitMs: Number(perf.lockWaitMs || 0),
    sheetReadMs: Number(perf.sheetReadMs || 0),
    sheetWriteMs: Number(perf.sheetWriteMs || 0),
    journalMs: Number(perf.journalMs || 0),
    auditMs: Number(perf.auditMs || 0),
    criticalMs: Number(perf.criticalMs || 0),
    transportRoundTripMs: Math.round(elapsed),
    clientTransport: "FORM_POST_V4",
  };
  diagnostics.lastServerMs = Number(merged.totalServerMs || 0);
  diagnostics.lastPerf = merged;
  result.__perf = merged as Record<string, unknown>;
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
    if (result && typeof result === "object" && !Array.isArray(result)) mergePerf(result, elapsed);
    request.resolve(result);
  });
}

/**
 * LOCKED production transport: GitHub Pages -> hidden iframe/form POST -> Apps Script doPost
 * -> HtmlOutput -> window.top.postMessage. Do not replace with a persistent bridge.
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
      diagnostics.lastErrorMessage = "Respons transaksi belum diterima. Status akan diperiksa berdasarkan requestId.";
      reject(rpcError(diagnostics.lastErrorMessage, diagnostics.lastErrorCode));
    }, timeoutMs);

    pending.set(id, { method, startedAt, resolve: resolve as (value: unknown) => void, reject, timer, cleanup });
    try {
      form.submit();
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

function sleep(ms: number) { return new Promise<void>((resolve) => window.setTimeout(resolve, ms)); }
function emitOperation(type: "start" | "slow" | "end", detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(`melesat:operation-${type}`, { detail }));
}

function sanitizeWaResult<T>(method: string, input: T): T {
  if (!input || typeof input !== "object" || Array.isArray(input) || WA_RESULT_METHODS.has(method)) return input;
  const result = { ...(input as Record<string, unknown>) };
  delete result.waAction;
  delete result.waActions;
  return result as T;
}

function ensureMutationRequestId(name: string, data: Record<string, unknown>) {
  if (!MUTATION_METHODS.has(name)) return data;
  if (String(data.requestId || "").trim()) return data;
  return { ...data, requestId: requestId(name.toLowerCase()) };
}

async function reconcileReceipt<T>(reqId: string): Promise<T | null> {
  if (!reqId) return null;
  const deadline = Date.now() + RECEIPT_RECONCILE_BUDGET_MS;
  while (Date.now() < deadline) {
    try {
      const receipt = await rpc<MutationReceipt>("mutationReceipt", { requestId: reqId }, token(), 5_000);
      const status = String(receipt.status || "UNKNOWN").toUpperCase();
      if (status === "COMMITTED") return ((receipt.result || receipt) as unknown) as T;
      if (status === "FAILED") {
        throw rpcError(receipt.error?.message || "Transaksi gagal.", receipt.error?.code || "MUTATION_FAILED", receipt);
      }
    } catch (error) {
      const code = String((error as Error & { code?: string })?.code || "");
      // Older backend without receipt route: stop reconciliation and surface a safe uncertainty message.
      if (["UNKNOWN_METHOD", "METHOD_NOT_FOUND", "BAD_METHOD", "API_ERROR"].includes(code)) return null;
    }
    await sleep(RECEIPT_POLL_MS + Math.floor(Math.random() * 180));
  }
  return null;
}

export async function ping() {
  const authToken = getStoredSession()?.token || "";
  return rpc<Record<string, unknown>>("healthCheck", {}, authToken, 7_000);
}

export async function login(username: string, pin: string): Promise<AppUser> {
  const operationId = requestId("login");
  emitOperation("start", { operationId, method: "loginWithPin", label: "Memeriksa akun…" });
  const slowTimer = window.setTimeout(() => emitOperation("slow", { operationId, method: "loginWithPin" }), ACK_SLOW_MS);
  try {
    const result = await rpc<{ token: string; session?: { maxAgeSeconds?: number; expiresAt?: string }; user: AppUser }>(
      "loginWithPin", { username: username.trim(), pin }, "", 15_000,
    );
    if (!result.token || !result.user) throw new Error("Server tidak mengembalikan sesi login yang valid.");
    const maxAge = Number(result.session?.maxAgeSeconds || 21_600);
    saveSession({ token: result.token, expiresAt: Date.now() + maxAge * 1000, sessionEndsAt: Date.now() + maxAge * 1000, user: result.user });
    return result.user;
  } finally {
    window.clearTimeout(slowTimer);
    emitOperation("end", { operationId, method: "loginWithPin" });
  }
}

export async function callFunction<T = Record<string, unknown>>(name: string, originalData: Record<string, unknown> = {}): Promise<T> {
  const mutation = MUTATION_METHODS.has(name);
  const data = ensureMutationRequestId(name, originalData);
  const reqId = String(data.requestId || "");
  const attempts = mutation ? 3 : 1;
  const operationId = reqId || requestId(name.toLowerCase());
  let lastError: unknown = null;
  let slowTimer = 0;

  if (mutation) {
    mutationInFlight += 1;
    emitOperation("start", { operationId, requestId: reqId, method: name, label: "Sedang diproses…" });
    slowTimer = window.setTimeout(() => emitOperation("slow", { operationId, requestId: reqId, method: name }), ACK_SLOW_MS);
  }

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await rpc<T>(name, data, token(), mutation ? MUTATION_TRANSPORT_TIMEOUT_MS : 18_000);
        if (mutation) window.dispatchEvent(new CustomEvent("melesat:local-mutation", { detail: { method: name, requestId: reqId, at: Date.now() } }));
        return sanitizeWaResult(name, result);
      } catch (error) {
        lastError = error;
        const code = String((error as Error & { code?: string })?.code || "");
        if (mutation && ["REQUEST_TIMEOUT", "MUTATION_IN_PROGRESS"].includes(code) && reqId) {
          const reconciled = await reconcileReceipt<T>(reqId);
          if (reconciled) {
            window.dispatchEvent(new CustomEvent("melesat:local-mutation", { detail: { method: name, requestId: reqId, reconciled: true, at: Date.now() } }));
            return sanitizeWaResult(name, reconciled);
          }
          throw rpcError("Sedang menyelesaikan proses. Jangan ulangi tindakan; gunakan Perbarui untuk memeriksa hasil.", "MUTATION_CONFIRMATION_PENDING", { requestId: reqId });
        }
        if (!mutation || code !== "SERVER_BUSY" || attempt >= attempts - 1) throw error;
        await sleep(120 + Math.floor(Math.random() * 140) + attempt * 120);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Permintaan gagal.");
  } finally {
    if (mutation) {
      window.clearTimeout(slowTimer);
      mutationInFlight = Math.max(0, mutationInFlight - 1);
      emitOperation("end", { operationId, requestId: reqId, method: name });
    }
  }
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

function emitPending(value: boolean) { window.dispatchEvent(new CustomEvent("melesat:update-pending", { detail: { pending: value } })); }
function emitDeltas(deltas: SignalDelta[]) { if (deltas.length) window.dispatchEvent(new CustomEvent("melesat:remote-delta", { detail: { deltas } })); }

const TAB_ID = crypto.randomUUID();
function leaderKey(role: Role) { return `melesat.poll.leader.${role}`; }
function tryLeader(role: Role) {
  const key = leaderKey(role), now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null") as { id?: string; expiresAt?: number } | null;
    if (!current || !current.id || Number(current.expiresAt || 0) < now || current.id === TAB_ID) {
      localStorage.setItem(key, JSON.stringify({ id: TAB_ID, expiresAt: now + 8_000 }));
      return true;
    }
  } catch { return true; }
  return false;
}
function renewLeader(role: Role) { try { localStorage.setItem(leaderKey(role), JSON.stringify({ id: TAB_ID, expiresAt: Date.now() + 8_000 })); } catch { /* noop */ } }
function releaseLeader(role: Role) { try { const x = JSON.parse(localStorage.getItem(leaderKey(role)) || "null"); if (x?.id === TAB_ID) localStorage.removeItem(leaderKey(role)); } catch { /* noop */ } }

/**
 * Signal-first realtime: normal signal path must be zero-sheet on the backend.
 * Active tab ~3 s + jitter; hidden/idle 15–20 s. Full workspace refresh only on resyncRequired.
 */
export async function subscribeWorkspaceSignals(role: Role, onChange: () => void, onStatus: (status: RealtimeStatus) => void): Promise<() => void> {
  let stopped = false, timer = 0, signature = "", pendingUpdate = false;
  let revisions: Record<string, number> = {};
  let pendingDeltas: SignalDelta[] = [];
  let pendingResync = false;
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(`melesat-signal-${role}`); } catch { channel = null; }

  const flushPending = () => {
    if (interactionBusy()) return;
    if (pendingDeltas.length) { emitDeltas(pendingDeltas); pendingDeltas = []; }
    if (pendingResync) { pendingResync = false; onChange(); }
    pendingUpdate = false;
    emitPending(false);
  };

  const applySignal = (result: { signature?: string; revisions?: Record<string, number>; deltas?: SignalDelta[]; resyncRequired?: boolean }) => {
    const next = String(result.signature || "");
    const changed = Boolean(signature && next && next !== signature);
    if (next) signature = next;
    if (result.revisions) revisions = result.revisions;
    const deltas = Array.isArray(result.deltas) ? result.deltas : [];
    if (changed && interactionBusy()) {
      pendingUpdate = true;
      pendingDeltas.push(...deltas);
      pendingResync = pendingResync || Boolean(result.resyncRequired);
      emitPending(true);
      return;
    }
    if (pendingDeltas.length && !interactionBusy()) { emitDeltas(pendingDeltas); pendingDeltas = []; }
    if (deltas.length) emitDeltas(deltas);
    if ((pendingResync || (result.resyncRequired && changed)) && !interactionBusy()) { pendingResync = false; onChange(); }
    pendingUpdate = false;
    emitPending(false);
  };

  if (channel) channel.onmessage = (event) => {
    if (!stopped && event.data?.type === "signal") { applySignal(event.data.payload || {}); onStatus("live"); }
  };

  const nextDelay = () => {
    if (document.visibilityState !== "visible") return 16_000 + Math.floor(Math.random() * 3_500);
    return 2_850 + Math.floor(Math.random() * 500);
  };
  const schedule = (delay = nextDelay()) => { window.clearTimeout(timer); if (!stopped) timer = window.setTimeout(check, delay); };
  const check = async () => {
    if (stopped) return;
    if (document.visibilityState !== "visible") return schedule();
    if (mutationInFlight > 0) return schedule(600 + Math.floor(Math.random() * 300));
    const leader = tryLeader(role);
    if (!leader) return schedule(3_000 + Math.floor(Math.random() * 500));
    renewLeader(role);
    onStatus(signature ? "live" : "connecting");
    try {
      const result = await callFunction<{ signature: string; revisions: Record<string, number>; deltas?: SignalDelta[]; resyncRequired?: boolean }>("workspaceSignals", { role, revisions });
      applySignal(result);
      channel?.postMessage({ type: "signal", payload: result });
      onStatus("live");
      schedule();
    } catch {
      onStatus("offline");
      schedule(5_000 + Math.floor(Math.random() * 1_000));
    }
  };

  const onVisibility = () => {
    window.clearTimeout(timer);
    if (document.visibilityState === "visible") { if (pendingUpdate) flushPending(); void check(); }
    else schedule();
  };
  const onFocusOut = () => window.setTimeout(() => { if (pendingUpdate) flushPending(); }, 80);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("focusout", onFocusOut, true);
  onStatus("connecting");
  void check();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    emitPending(false);
    releaseLeader(role);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("focusout", onFocusOut, true);
    channel?.close();
  };
}
