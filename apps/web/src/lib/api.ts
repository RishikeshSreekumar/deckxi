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
  /** Games and wins per mode id; modes never played are absent. */
  byMode: Record<string, { games: number; wins: number }>;
}

/** One standing on the ladder (#80): a mode, a season, and where you sit. */
export interface RatingRow {
  gameMode: string;
  seasonId: string;
  rating: number;
  games: number;
  wins: number;
}

export interface CollectionCard {
  editionId: string;
  cardId: string;
  wins: number;
  firstWonAt: string;
  lastWonAt: string;
}

export interface ShowcaseCard {
  editionId: string;
  cardId: string;
}

export interface Profile {
  user: ProfileUser;
  stats: ProfileStats;
  /** Absent on an account that has never finished a rated game. */
  ratings?: RatingRow[];
  /** The card this player pinned to their profile (#84). */
  showcase?: ShowcaseCard | null;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string | null;
  rating: number;
  games: number;
  wins: number;
}

export interface Leaderboard {
  mode: string;
  season: string;
  rows: LeaderboardRow[];
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

/** The ladder for one mode. Public — no session needed. */
export const fetchLeaderboard = (mode: string): Promise<Leaderboard> =>
  get<Leaderboard>(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);

export const fetchCollection = (): Promise<{
  cards: CollectionCard[];
  showcase: ShowcaseCard | null;
}> => get<{ cards: CollectionCard[]; showcase: ShowcaseCard | null }>("/api/me/collection");

/** Pin a card to your profile, or pass null to clear it. */
export async function setShowcase(card: ShowcaseCard | null): Promise<void> {
  const response = await fetch(`${API_URL}/api/me/showcase`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card ?? { cardId: null }),
  });
  if (!response.ok) throw new Error(`showcase failed (${response.status})`);
}

export const fetchMatches = async (): Promise<MatchSummary[]> =>
  (await get<{ matches: MatchSummary[] }>("/api/me/matches")).matches;
