import { getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence,
  signInWithCustomToken, signOut,
} from "firebase/auth";
import {
  collection, connectFirestoreEmulator, getFirestore, limit, onSnapshot,
  orderBy, query,
} from "firebase/firestore";

export type Role = "FARMASI" | "KURIR" | "ADMIN" | "MANAJEMEN";

export interface AppUser {
  uid: string;
  username: string;
  name: string;
  role: Role;
  active?: boolean;
}

interface StoredSession {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionEndsAt: number;
  user: AppUser;
}

type FireValue = Record<string, unknown>;

const raw = window.MELESAT_CONFIG || {};
const localHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const config = {
  projectId: raw.projectId || "melesat-dev",
  apiKey: raw.apiKey || "demo-key",
  region: raw.region || "asia-southeast2",
  emulator: raw.emulator === true || (raw.emulator === "auto" && localHost),
  appVersion: raw.appVersion || "PRODUKSI-V1",
};

const KEY = "melesat.session.v1";

const firebaseApp = getApps()[0] || initializeApp({
  apiKey: config.apiKey,
  projectId: config.projectId,
  authDomain: `${config.projectId}.firebaseapp.com`,
});
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
if (config.emulator) {
  try { connectAuthEmulator(firebaseAuth, "http://127.0.0.1:9099", { disableWarnings: true }); } catch { /* already connected by hot reload */ }
  try { connectFirestoreEmulator(firestore, "127.0.0.1", 8080); } catch { /* already connected by hot reload */ }
}

function apiError(payload: unknown, fallback: string) {
  const body = payload as { error?: { message?: string; details?: { message?: string } } };
  return body?.error?.details?.message || body?.error?.message || fallback;
}

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload as { error?: unknown }).error) {
    throw new Error(apiError(payload, `Permintaan gagal (${response.status}).`));
  }
  return payload as Record<string, unknown>;
}

function unwrapCallable(response: Record<string, unknown>) {
  const envelope = (response.result || response) as Record<string, unknown>;
  if (envelope.ok === true && envelope.data && typeof envelope.data === "object") {
    return envelope.data as Record<string, unknown>;
  }
  return envelope;
}

function secureTokenBase() {
  return config.emulator
    ? "http://127.0.0.1:9099/securetoken.googleapis.com/v1"
    : "https://securetoken.googleapis.com/v1";
}

function functionUrl(name: string) {
  return config.emulator
    ? `http://127.0.0.1:5001/${config.projectId}/${config.region}/${name}`
    : `https://${config.region}-${config.projectId}.cloudfunctions.net/${name}`;
}

function saveSession(session: StoredSession) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
  void signOut(firebaseAuth).catch(() => undefined);
}

export function getStoredSession(): StoredSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null") as StoredSession | null;
    if (!value || value.sessionEndsAt <= Date.now()) {
      clearSession();
      return null;
    }
    return value;
  } catch {
    clearSession();
    return null;
  }
}

async function refresh(session: StoredSession): Promise<StoredSession> {
  if (session.sessionEndsAt <= Date.now()) throw new Error("Sesi sudah berakhir. Silakan masuk kembali.");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken });
  const result = await jsonFetch(`${secureTokenBase()}/token?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const next: StoredSession = {
    ...session,
    idToken: String(result.id_token || result.idToken || ""),
    refreshToken: String(result.refresh_token || session.refreshToken),
    expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 - 30_000,
  };
  saveSession(next);
  return next;
}

async function token() {
  const current = getStoredSession();
  if (!current) throw new Error("Sesi tidak tersedia. Silakan masuk kembali.");
  await firebaseAuth.authStateReady();
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser.getIdToken();
  return current.expiresAt > Date.now() ? current.idToken : (await refresh(current)).idToken;
}

export async function ping() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const result = await jsonFetch(functionUrl("healthCheck"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
      signal: controller.signal,
    });
    return unwrapCallable(result);
  } finally {
    clearTimeout(timeout);
  }
}

export async function login(username: string, pin: string): Promise<AppUser> {
  const response = await jsonFetch(functionUrl("loginWithPin"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { username: username.trim(), pin } }),
  });
  const result = unwrapCallable(response);
  const customToken = String(result.customToken || "");
  if (!customToken) throw new Error("Server tidak mengembalikan token login.");
  await setPersistence(firebaseAuth, browserSessionPersistence);
  const credential = await signInWithCustomToken(firebaseAuth, customToken);
  const idToken = await credential.user.getIdToken();
  const user = result.user as unknown as AppUser;
  const maxAge = Number((result.session as Record<string, unknown> | undefined)?.maxAgeSeconds || 21600);
  saveSession({
    idToken,
    refreshToken: "",
    expiresAt: Date.now() + 3_570_000,
    sessionEndsAt: Date.now() + maxAge * 1000,
    user,
  });
  return user;
}

export async function callFunction<T = Record<string, unknown>>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  // Universal UI compatibility: Apps Script exposes a consolidated system-health
  // endpoint. Firebase v1.0.0 predates that display contract, so the provider
  // adapts existing Firebase health + retention endpoints without touching App.tsx.
  if (name === "adminSystemHealth") {
    const [service, retention] = await Promise.all([
      ping(),
      callFunction<Record<string, unknown>>("adminRetentionStatus", {}),
    ]);
    return {
      health: {
        status: service ? "AMAN" : "PERLU PERHATIAN",
        operationalHold: false,
        lastBackupAt: "",
        lastCheckpointAt: "",
        archive: { status: "NORMAL", lastSyncAt: "" },
        recommendation: "Backend Firebase aktif. Backup dan recovery mengikuti Firebase resilience engine.",
        provider: "FIREBASE",
        retention,
      },
    } as T;
  }
  const response = await jsonFetch(functionUrl(name), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ data }),
  });
  return unwrapCallable(response) as T;
}

function decodeValue(value: FireValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("arrayValue" in value) {
    const values = ((value.arrayValue as FireValue)?.values || []) as FireValue[];
    return values.map(decodeValue);
  }
  if ("mapValue" in value) return decodeFields(((value.mapValue as FireValue)?.fields || {}) as Record<string, FireValue>);
  return undefined;
}

function decodeFields(fields: Record<string, FireValue>) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export async function listCollection<T extends Record<string, unknown>>(collection: string, pageSize = 300): Promise<T[]> {
  const base = config.emulator
    ? `http://127.0.0.1:8080/v1/projects/${config.projectId}/databases/(default)/documents`
    : `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
  let pageToken = "";
  const rows: T[] = [];
  do {
    const query = new URLSearchParams({ pageSize: String(Math.min(pageSize, 300)) });
    if (pageToken) query.set("pageToken", pageToken);
    const payload = await jsonFetch(`${base}/${collection}?${query}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const docs = (payload.documents || []) as Array<{ name: string; fields?: Record<string, FireValue> }>;
    rows.push(...docs.map((doc) => ({ id: doc.name.split("/").pop(), ...decodeFields(doc.fields || {}) }) as unknown as T));
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken && rows.length < pageSize);
  return rows;
}

export function requestId(prefix = "web") {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function isEmulator() {
  return config.emulator;
}

export type RealtimeStatus = "connecting" | "live" | "offline";

/**
 * Listen only to privacy-safe invalidation documents. Patient data continues to
 * come from role-aware Callable Functions, so receipt codes/PII never enter the
 * directly readable realtime collection.
 */
export async function subscribeWorkspaceSignals(
  role: Role,
  onChange: () => void,
  onStatus: (status: RealtimeStatus) => void,
): Promise<() => void> {
  onStatus("connecting");
  await firebaseAuth.authStateReady();
  if (!firebaseAuth.currentUser) {
    onStatus("offline");
    return () => undefined;
  }
  let initialized = false;
  const feed = query(
    collection(firestore, "workspaceSignals", role, "events"),
    orderBy("changedAt", "desc"),
    limit(1),
  );
  return onSnapshot(feed, snapshot => {
    onStatus("live");
    if (!initialized) { initialized = true; return; }
    if (snapshot.docChanges().some(change => change.type === "added" || change.type === "modified" || change.type === "removed")) onChange();
  }, () => onStatus("offline"));
}
