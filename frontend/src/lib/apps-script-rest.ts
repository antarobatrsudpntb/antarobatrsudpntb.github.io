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

function rpc<T = Record<string, unknown>>(method: string, data: Record<string, unknown>, authToken = "", timeoutMs = 25_000): Promise<T> {
  ensureConfigured();
  return new Promise<T>((resolve, reject) => {
    const id = `rpc_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const nonce = crypto.randomUUID();
    const iframe = document.createElement("iframe");
    iframe.name = `melesat_rpc_${id}`;
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");

    const form = document.createElement("form");
    form.method = "POST";
    form.action = config.appsScriptUrl;
    form.target = iframe.name;
    form.hidden = true;

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "rpc";
    input.value = JSON.stringify({
      type: MESSAGE_TYPE,
      id,
      nonce,
      origin: window.location.origin,
      method,
      token: authToken,
      data,
    });
    form.appendChild(input);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      form.remove();
      window.setTimeout(() => iframe.remove(), 0);
    };
    const onMessage = (event: MessageEvent<RpcResponse>) => {
      const message = event.data;
      const googleOrigin =
        event.origin === "null" ||
        /^https:\/\/script\.google\.com$/.test(event.origin) ||
        /^https:\/\/script\.googleusercontent\.com$/.test(event.origin) ||
        /^https:\/\/[^/]+\.googleusercontent\.com$/.test(event.origin);
      if (!googleOrigin) return;
      if (!message || message.type !== MESSAGE_TYPE || message.id !== id || message.nonce !== nonce) return;
      cleanup();
      if (!message.ok) {
        const error = new Error(message.error?.message || "Permintaan Apps Script gagal.");
        (error as Error & { code?: string; data?: unknown }).code = message.error?.code;
        (error as Error & { data?: unknown }).data = message.error?.data;
        reject(error);
        return;
      }
      resolve((message.result || {}) as T);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Apps Script tidak merespons dalam batas waktu. Periksa koneksi atau deployment Web App."));
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
}

export async function ping() {
  return rpc<Record<string, unknown>>("healthCheck", {}, getStoredSession()?.token || "", 7000);
}

export async function login(username: string, pin: string): Promise<AppUser> {
  const result = await rpc<{ token: string; session?: { maxAgeSeconds?: number; expiresAt?: string }; user: AppUser }>(
    "loginWithPin",
    { username: username.trim(), pin },
    "",
    12_000,
  );
  if (!result.token || !result.user) throw new Error("Server tidak mengembalikan sesi login yang valid.");
  const maxAge = Number(result.session?.maxAgeSeconds || 21_600);
  saveSession({
    token: result.token,
    expiresAt: Date.now() + maxAge * 1000,
    sessionEndsAt: Date.now() + maxAge * 1000,
    user: result.user,
  });
  return result.user;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export async function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const mutation = MUTATION_METHODS.has(name);
  const attempts = mutation ? 3 : 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await rpc<T>(name, data, token(), mutation ? 12_000 : 25_000);
      if (mutation) window.dispatchEvent(new CustomEvent("melesat:local-mutation", { detail: { method: name, at: Date.now() } }));
      return result;
    } catch (error) {
      lastError = error;
      const code = String((error as Error & { code?: string })?.code || "");
      if (!mutation || !["SERVER_BUSY", "MUTATION_IN_PROGRESS"].includes(code) || attempt >= attempts - 1) throw error;
      const jitter = 240 + attempt * 420 + Math.floor(Math.random() * 240);
      await sleep(jitter);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Permintaan gagal.");
}

export function requestId(prefix = "web") {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function isEmulator() {
  return false;
}

function interactionBusy() {
  if (document.documentElement.classList.contains("melesat-interaction-busy")) return true;
  const active = document.activeElement as HTMLElement | null;
  const tag = active?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || active?.isContentEditable) return true;
  return Boolean(document.querySelector(".modal-layer"));
}

function emitPending(pending: boolean) {
  window.dispatchEvent(new CustomEvent("melesat:update-pending", { detail: { pending } }));
}

/**
 * Apps Script has no push listener. This implementation polls only a tiny,
 * privacy-safe revision vector and reloads workspace data only when the vector
 * changes. Polling stops while the tab is hidden and backs off when quiet.
 */
export async function subscribeWorkspaceSignals(
  role: Role,
  onChange: () => void,
  onStatus: (status: RealtimeStatus) => void,
): Promise<() => void> {
  let stopped = false;
  let timer = 0;
  let signature = "";
  let unchanged = 0;
  let pending = false;
  let localMutationAt = 0;
  let reconcileTimer = 0;
  const base = role === "FARMASI" || role === "KURIR" ? 12_000 : role === "ADMIN" ? 30_000 : 45_000;
  const cap = role === "FARMASI" || role === "KURIR" ? 30_000 : 60_000;

  const nextDelay = () => {
    if (unchanged < 4) return base;
    if (unchanged < 10) return Math.min(cap, Math.max(base, 20_000));
    return cap;
  };

  const schedule = (delay = nextDelay()) => {
    window.clearTimeout(timer);
    if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(check, delay);
  };

  const applyPendingIfSafe = () => {
    if (!pending || interactionBusy() || stopped) return false;
    pending = false;
    emitPending(false);
    onChange();
    unchanged = 0;
    return true;
  };

  const check = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    onStatus(signature ? "live" : "connecting");
    try {
      const result = await callFunction<{ signature: string }>("workspaceSignals", { role });
      const next = String(result.signature || "");
      if (!signature) {
        signature = next;
        unchanged = 0;
      } else if (next && next !== signature) {
        signature = next;
        unchanged = 0;
        const ownMutationWindow = localMutationAt > 0 && Date.now() - localMutationAt < 20_000;
        if (ownMutationWindow) {
          // Mutation lokal sudah mem-patch UI dari response server. Jangan langsung full-refresh lagi.
          localMutationAt = 0;
          pending = false;
          emitPending(false);
          window.clearTimeout(reconcileTimer);
          reconcileTimer = window.setTimeout(() => {
            if (!stopped && !interactionBusy() && document.visibilityState === "visible") onChange();
          }, 20_000);
        } else if (interactionBusy()) {
          pending = true;
          emitPending(true);
        } else {
          pending = false;
          emitPending(false);
          onChange();
        }
      } else {
        unchanged += 1;
        applyPendingIfSafe();
      }
      onStatus("live");
      schedule();
    } catch {
      onStatus("offline");
      schedule(Math.min(cap, Math.max(20_000, nextDelay())));
    }
  };

  const onVisibility = () => {
    window.clearTimeout(timer);
    if (document.visibilityState === "visible") {
      applyPendingIfSafe();
      void check();
    }
  };
  const onFocusOut = () => window.setTimeout(() => {
    if (applyPendingIfSafe()) schedule(base);
  }, 80);

  const onLocalMutation = (event: Event) => {
    localMutationAt = Number((event as CustomEvent<{ at?: number }>).detail?.at || Date.now());
    pending = false;
    emitPending(false);
  };

  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("focusout", onFocusOut, true);
  window.addEventListener("melesat:local-mutation", onLocalMutation);
  onStatus("connecting");
  void check();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearTimeout(reconcileTimer);
    emitPending(false);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("melesat:local-mutation", onLocalMutation);
  };
}
