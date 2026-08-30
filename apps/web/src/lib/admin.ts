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

export interface MatchListRow {
  matchId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: string;
  finishedAt: string | null;
  rounds: number | null;
  endReason: string | null;
  playerNames: string[];
}

/** A match with its full, unredacted engine event log — the replay input. */
export interface StoredMatch {
  matchId: string;
  roomId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: string;
  players: { sessionId: string; userId: string | null; name: string; seat: number }[];
  events: { seq: number; event: Record<string, unknown> }[];
  result: {
    finishedAt: string;
    winnerSessionId: string;
    endReason: string;
    rounds: number;
  } | null;
}

export interface OpsFlags {
  notice: { text: string; level: "info" | "warning" } | null;
  modes: Record<string, boolean>;
}

async function adminSend<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/api/admin${path}`, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 404) throw new NotAdminError();
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export const fetchAdminFlags = (): Promise<{ flags: OpsFlags }> =>
  adminGet<{ flags: OpsFlags }>("/flags");

export const saveAdminFlags = (
  patch: Partial<OpsFlags>,
): Promise<{ ok: boolean; flags: OpsFlags }> =>
  adminSend<{ ok: boolean; flags: OpsFlags }>("/flags", "PUT", patch);

export const closeAdminRoom = (roomId: string): Promise<{ ok: boolean }> =>
  adminSend<{ ok: boolean }>(`/rooms/${encodeURIComponent(roomId)}/close`, "POST");

export const kickAdminSession = (roomId: string, sessionId: string): Promise<{ ok: boolean }> =>
  adminSend<{ ok: boolean }>(`/rooms/${encodeURIComponent(roomId)}/kick`, "POST", { sessionId });

export const fetchAdminSession = (): Promise<AdminSession> => adminGet<AdminSession>("/session");

export const fetchAdminRooms = (): Promise<AdminRooms> => adminGet<AdminRooms>("/rooms");

export const fetchAdminRoom = (roomId: string): Promise<{ room: AdminRoomDetail | null }> =>
  adminGet<{ room: AdminRoomDetail | null }>(`/rooms/${encodeURIComponent(roomId)}`);

export const fetchAdminMatches = (): Promise<{ matches: MatchListRow[] }> =>
  adminGet<{ matches: MatchListRow[] }>("/matches");

export const fetchAdminMatch = (matchId: string): Promise<{ match: StoredMatch | null }> =>
  adminGet<{ match: StoredMatch | null }>(`/matches/${encodeURIComponent(matchId)}`);

export const fetchAdminEvents = (
  since: number,
  roomId?: string,
): Promise<{ entries: FeedEntry[]; cursor: number }> => {
  const params = new URLSearchParams({ since: String(since) });
  if (roomId !== undefined) params.set("roomId", roomId);
  return adminGet<{ entries: FeedEntry[]; cursor: number }>(`/events?${params.toString()}`);
};
