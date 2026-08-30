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

export interface AdminRoomDetail extends AdminRoomSummary {
  settings: Record<string, unknown>;
  hostId: string;
  sessions: {
    id: string;
    name: string;
    userId: string | null;
    seat: number;
    spectator: boolean;
    ready: boolean;
    connected: boolean;
  }[];
  game: {
    matchId: string;
    editionId: string;
    phase: string;
    round: number;
    leader: string;
    pot: string[];
    winner: string | null;
    startedAt: number;
    turnDeadline: number | null;
    events: number;
    players: { id: string; active: boolean; hand: string[] }[];
  } | null;
  recentEvents: { seq: number; type: string; event: unknown }[];
}

export interface FeedEntry {
  seq: number;
  at: number;
  level: string;
  event: string;
  message: string | null;
  fields: Record<string, string | number | boolean | null>;
}

export const fetchAdminSession = (): Promise<AdminSession> => adminGet<AdminSession>("/session");

export const fetchAdminRooms = (): Promise<AdminRooms> => adminGet<AdminRooms>("/rooms");

export const fetchAdminRoom = (roomId: string): Promise<{ room: AdminRoomDetail | null }> =>
  adminGet<{ room: AdminRoomDetail | null }>(`/rooms/${encodeURIComponent(roomId)}`);

export const fetchAdminEvents = (
  since: number,
  roomId?: string,
): Promise<{ entries: FeedEntry[]; cursor: number }> => {
  const params = new URLSearchParams({ since: String(since) });
  if (roomId !== undefined) params.set("roomId", roomId);
  return adminGet<{ entries: FeedEntry[]; cursor: number }>(`/events?${params.toString()}`);
};
