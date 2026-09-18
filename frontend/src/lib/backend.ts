import * as appsScript from "./apps-script-rest";
import type { AppUser, RealtimeStatus, Role, StoredSessionBase } from "./backend-types";

export type { AppUser, RealtimeStatus, Role } from "./backend-types";

type FirebaseProvider = typeof import("./firebase-rest");
type StoredSession = StoredSessionBase & Record<string, unknown>;

const raw = window.MELESAT_CONFIG || {};
export const backendProvider = String(raw.backendProvider || "firebase").toLowerCase() === "apps-script" ? "apps-script" : "firebase";
const FIREBASE_SESSION_KEY = "melesat.session.v1";
let firebasePromise: Promise<FirebaseProvider> | null = null;

function loadFirebase() {
  if (!firebasePromise) firebasePromise = import("./firebase-rest");
  return firebasePromise;
}

function readFirebaseSession(): StoredSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(FIREBASE_SESSION_KEY) || "null") as StoredSession | null;
    if (!value || !value.user || Number(value.sessionEndsAt || 0) <= Date.now()) {
      sessionStorage.removeItem(FIREBASE_SESSION_KEY);
      return null;
    }
    return value;
  } catch {
    sessionStorage.removeItem(FIREBASE_SESSION_KEY);
    return null;
  }
}

export function clearSession() {
  if (backendProvider === "apps-script") return appsScript.clearSession();
  sessionStorage.removeItem(FIREBASE_SESSION_KEY);
  void loadFirebase().then((provider) => provider.clearSession()).catch(() => undefined);
}

export function getStoredSession() {
  return backendProvider === "apps-script" ? appsScript.getStoredSession() : readFirebaseSession();
}

export function isEmulator() {
  if (backendProvider === "apps-script") return false;
  const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return raw.emulator === true || (raw.emulator === "auto" && localHost);
}

export function requestId(prefix = "web") {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function ping() {
  return backendProvider === "apps-script" ? appsScript.ping() : loadFirebase().then((provider) => provider.ping());
}

export function getTransportDiagnostics() {
  if (backendProvider === "apps-script") return appsScript.getTransportDiagnostics();
  return { transport: "FIREBASE", endpointConfigured: true, lastMethod: "", lastRoundTripMs: 0, lastServerMs: 0, lastOkAt: 0, lastErrorCode: "", lastErrorMessage: "", activeRequests: 0, lastPerf: {} };
}

export async function login(username: string, pin: string): Promise<AppUser> {
  if (backendProvider === "apps-script") return appsScript.login(username, pin) as Promise<AppUser>;
  const provider = await loadFirebase();
  return provider.login(username, pin) as Promise<AppUser>;
}

function witaDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (backendProvider === "apps-script") return appsScript.callFunction<T>(name, data);
  const provider = await loadFirebase();
  // Preserve the Firebase-compatible workflow without loading Firebase into the Apps Script initial bundle.
  if (name === "scheduleRedelivery") {
    const request = String(data.requestId || requestId("redelivery"));
    const planned = await provider.callFunction<Record<string, unknown>>("planRedelivery", { ...data, requestId: `${request}_plan` });
    const payload = (data.payload || {}) as Record<string, unknown>;
    if (String(payload.scheduleDate || "") > witaDateKey()) return planned as T;
    return provider.callFunction<T>("createRedelivery", { ...data, requestId: `${request}_create` });
  }
  return provider.callFunction<T>(name, data);
}

export async function subscribeWorkspaceSignals(role: Role, onChange: () => void, onStatus: (status: RealtimeStatus) => void): Promise<() => void> {
  if (backendProvider === "apps-script") return appsScript.subscribeWorkspaceSignals(role, onChange, onStatus);
  const provider = await loadFirebase();
  return provider.subscribeWorkspaceSignals(role, onChange, onStatus);
}
