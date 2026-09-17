import * as appsScript from "./apps-script-rest";
import * as firebase from "./firebase-rest";
import type { AppUser, RealtimeStatus, Role } from "./backend-types";

export type { AppUser, RealtimeStatus, Role } from "./backend-types";

const raw = window.MELESAT_CONFIG || {};
export const backendProvider = String(raw.backendProvider || "firebase").toLowerCase() === "apps-script" ? "apps-script" : "firebase";
const provider = backendProvider === "apps-script" ? appsScript : firebase;

export function clearSession() { return provider.clearSession(); }
export function getStoredSession() { return provider.getStoredSession(); }
export function isEmulator() { return provider.isEmulator(); }
export function requestId(prefix = "web") { return provider.requestId(prefix); }
export function ping() { return provider.ping(); }

export function getTransportDiagnostics() {
  if (backendProvider === "apps-script" && typeof appsScript.getTransportDiagnostics === "function") return appsScript.getTransportDiagnostics();
  return { transport: "FIREBASE", endpointConfigured: true, lastMethod: "", lastRoundTripMs: 0, lastServerMs: 0, lastOkAt: 0, lastErrorCode: "", lastErrorMessage: "", activeRequests: 0 };
}
export function login(username: string, pin: string): Promise<AppUser> { return provider.login(username, pin) as Promise<AppUser>; }
function witaDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (name === "scheduleRedelivery" && backendProvider === "firebase") {
    const request = String(data.requestId || requestId("redelivery"));
    const planned = await firebase.callFunction<Record<string, unknown>>("planRedelivery", { ...data, requestId: `${request}_plan` });
    const payload = (data.payload || {}) as Record<string, unknown>;
    if (String(payload.scheduleDate || "") > witaDateKey()) return planned as T;
    return firebase.callFunction<T>("createRedelivery", { ...data, requestId: `${request}_create` });
  }
  return provider.callFunction<T>(name, data);
}
export function subscribeWorkspaceSignals(role: Role, onChange: () => void, onStatus: (status: RealtimeStatus) => void): Promise<() => void> {
  return provider.subscribeWorkspaceSignals(role, onChange, onStatus);
}
