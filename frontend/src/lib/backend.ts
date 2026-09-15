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
export function login(username: string, pin: string): Promise<AppUser> { return provider.login(username, pin) as Promise<AppUser>; }
export function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  return provider.callFunction<T>(name, data);
}
export function subscribeWorkspaceSignals(role: Role, onChange: () => void, onStatus: (status: RealtimeStatus) => void): Promise<() => void> {
  return provider.subscribeWorkspaceSignals(role, onChange, onStatus);
}
