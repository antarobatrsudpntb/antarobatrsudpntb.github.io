export type Role = "FARMASI" | "KURIR" | "ADMIN" | "MANAJEMEN";

export interface AppUser {
  uid: string;
  username: string;
  name: string;
  role: Role;
  active?: boolean;
}

export type RealtimeStatus = "connecting" | "live" | "offline";

export interface StoredSessionBase {
  user: AppUser;
  sessionEndsAt: number;
}
