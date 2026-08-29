/**
 * Profile REST — small typed fetch helpers over the server's /api routes
 * (session-cookie authenticated).
 */
import { API_URL } from "./socket.js";

export interface ProfileUser {
  id: string;
  name: string;
  image: string | null;
  isAnonymous: boolean;
  email: string | null;
}

export interface ProfileStats {
  games: number;
  wins: number;
  favouriteStat: string | null;
}

export interface Profile {
  user: ProfileUser;
  stats: ProfileStats;
}

export interface MatchSummary {
  matchId: string;
  roomCode: string;
  editionId: string;
  gameMode: string;
  startedAt: string;
  finishedAt: string | null;
  rounds: number | null;
  endReason: string | null;
  players: { name: string; userId: string | null }[];
  outcome: "won" | "lost" | "unfinished";
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export const fetchProfile = (): Promise<Profile> => get<Profile>("/api/me");

export const fetchMatches = async (): Promise<MatchSummary[]> =>
  (await get<{ matches: MatchSummary[] }>("/api/me/matches")).matches;
