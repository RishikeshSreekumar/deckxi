/**
 * Squad Draft — types. Rules in `docs/games/squad-draft.md`, which is
 * authoritative over this code.
 *
 * Three phases: `drafting` (a snake draft from a shared, face-up pool),
 * `building` (everyone names an XI from their squad, blind), `finished`
 * (every XI has played every other across three match phases and the
 * league table has a winner).
 */
import type { CardDefinition, CardId, PlayerId, StatDefinition, StatKey } from "../../types.js";

export const SQUAD_DRAFT_MODE = "squad-draft";

export const SQUAD_SIZE = 13;
export const XI_SIZE = 11;
export const BOWLER_COUNT = 5;
/** At most this many cards from one nation in a squad (enforced at draft time). */
export const NATION_CAP = 4;
/** Cards left in the pool once every squad is full — the last picker still chooses. */
export const POOL_SPARE = 5;
export const MIN_SQUAD_PLAYERS = 2;
export const MAX_SQUAD_PLAYERS = 4;

/** Which stat keys feed each facet of a card's strength. Missing keys score 0. */
export interface Facets {
  batting: StatKey[];
  bowling: StatKey[];
  fielding: StatKey[];
}

/**
 * The default facet map, by conventional stat key. The engine is otherwise
 * data-agnostic: keys absent from the edition are simply dropped, and a
 * facet with no surviving keys scores 0 for every card.
 */
export const DEFAULT_FACETS: Facets = {
  batting: ["battingAvg", "strikeRate", "runs", "highest"],
  bowling: ["wickets", "economy", "bestBowling"],
  fielding: ["catches"],
};

export interface SquadDraftConfigInput {
  players: PlayerId[];
  cards: CardDefinition[];
  stats: StatDefinition[];
  seed: number;
  squadSize?: number;
  xiSize?: number;
  bowlerCount?: number;
  nationCap?: number;
  facets?: Facets;
}

export interface SquadDraftConfig {
  mode: typeof SQUAD_DRAFT_MODE;
  players: PlayerId[];
  cards: CardDefinition[];
  stats: StatDefinition[];
  seed: number;
  squadSize: number;
  xiSize: number;
  bowlerCount: number;
  nationCap: number;
  facets: Facets;
}

/** A named XI: batting order, the five who bowl (in bowling order), the keeper. */
export interface Roster {
  order: CardId[];
  bowlers: CardId[];
  keeper: CardId;
}

export type SquadDraftPhase = "drafting" | "building" | "finished";

export type SquadPhaseKey = "powerplay" | "middle" | "finish";
export const SQUAD_PHASES: readonly SquadPhaseKey[] = ["powerplay", "middle", "finish"];

export interface PhaseReport {
  key: SquadPhaseKey;
  home: number;
  away: number;
  winner: PlayerId | null;
}

export interface MatchReport {
  home: PlayerId;
  away: PlayerId;
  phases: PhaseReport[];
  homePhases: number;
  awayPhases: number;
  /** Home minus away, summed over the phases. */
  margin: number;
  result: "home" | "away" | "draw";
}

export interface TableRow {
  playerId: PlayerId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  margin: number;
}

export interface LeagueResult {
  matches: MatchReport[];
  /** Sorted best first: points, then margin, then seat. */
  table: TableRow[];
}

export interface SquadDraftState {
  config: SquadDraftConfig;
  phase: SquadDraftPhase;
  /** Cards still in the pool, in layout order. */
  pool: CardId[];
  /** Every pick slot of the draft, in order (the full snake). */
  pickOrder: PlayerId[];
  /** Index into `pickOrder` of the next slot to fill (inactive seats are skipped). */
  pickIndex: number;
  squads: Record<PlayerId, CardId[]>;
  active: Record<PlayerId, boolean>;
  /** Submitted XIs; null until a player submits. */
  rosters: Record<PlayerId, Roster | null>;
  /** Form multipliers rolled when the matches were played. */
  form: Record<CardId, number> | null;
  league: LeagueResult | null;
  winner: PlayerId | null;
}

export type SquadDraftCommand =
  | { type: "DRAFT_PICK"; playerId: PlayerId; cardId: CardId }
  | { type: "SUBMIT_XI"; playerId: PlayerId; roster: Roster }
  /** Host: the player on the clock ran out of time (drafting or building). */
  | { type: "AUTO_PLAY"; playerId: PlayerId }
  | { type: "FORFEIT"; playerId: PlayerId };

export type SquadDraftEndReason = "league" | "opponents-forfeited";

export type SquadDraftEvent =
  | {
      type: "GAME_STARTED";
      config: SquadDraftConfig;
      /** The pool in layout order (a seeded shuffle of the config's cards). */
      pool: CardId[];
      pickOrder: PlayerId[];
    }
  | { type: "CARD_DRAFTED"; playerId: PlayerId; cardId: CardId; pick: number; auto: boolean }
  | { type: "DRAFT_COMPLETED" }
  | { type: "XI_SUBMITTED"; playerId: PlayerId; roster: Roster; auto: boolean }
  | { type: "PLAYER_FORFEITED"; playerId: PlayerId }
  | {
      type: "MATCHES_PLAYED";
      rosters: Record<PlayerId, Roster>;
      form: Record<CardId, number>;
      league: LeagueResult;
    }
  | { type: "GAME_ENDED"; winner: PlayerId; reason: SquadDraftEndReason };
