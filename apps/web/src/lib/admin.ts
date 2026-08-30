/**
 * Admin REST client (#67). Same shape as lib/api.ts: small typed fetch
 * helpers, types restated here rather than shared, because the admin API is
 * an operator tool that should be free to change without a protocol bump.
 *
 * The server answers 404 — never 401 — to a caller who isn't an admin, so
 * "not allowed" and "no such route" are the same response by design. This
 * module turns that into one error the UI can render as a plain not-found.
 */
import { API_URL } from "./socket.js";

export class NotAdminError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotAdminError";
  }
}

export interface AdminSession {
  admin: true;
  via: "session" | "token";
  email: string | null;
}

export interface AdminRoomSummary {
  roomId: string;
  code: string;
  phase: string;
  gameMode: string;
  editionId: string;
  hostName: string | null;
  players: number;
  disconnected: number;
  spectators: number;
  matchId: string | null;
  round: number | null;
  idleSeconds: number;
}

export interface AdminRooms {
  rooms: AdminRoomSummary[];
  counts: { rooms: number; games: number };
}

export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin${path}`, { credentials: "include" });
  if (response.status === 404) throw new NotAdminError();
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export const fetchAdminSession = (): Promise<AdminSession> => adminGet<AdminSession>("/session");

export const fetchAdminRooms = (): Promise<AdminRooms> => adminGet<AdminRooms>("/rooms");
