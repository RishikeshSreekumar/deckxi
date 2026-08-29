/**
 * Core types for the DeckXI game engine.
 *
 * The engine is a pure state machine: `applyCommand(state, command) → events[]`
 * and `reduce(state, event) → state`. Rules live in `docs/games/classic-trumps.md`,
 * which is authoritative over this code.
 */

export type PlayerId = string;
export type CardId = string;
export type StatKey = string;

/** Which end of the scale wins a comparison (bowling economy is "lower"). */
export type StatDirection = "higher" | "lower";

export interface StatDefinition {
  key: StatKey;
  direction: StatDirection;
  /** Bounds used for normalisation (auto-play, bots, UI bars). */
  min: number;
  max: number;
}

export interface CardDefinition {
  id: CardId;
  stats: Record<StatKey, number>;
}

/** Config as supplied by the caller; `maxRounds` defaults to 1000. */
export interface GameConfigInput {
  /** Seat-ordered player list, 2–6 players. */
  players: PlayerId[];
  cards: CardDefinition[];
  stats: StatDefinition[];
  seed: number;
  maxRounds?: number;
}

/** Normalised config as stored in the GAME_STARTED event. */
export interface GameConfig extends GameConfigInput {
  maxRounds: number;
}

export const DEFAULT_MAX_ROUNDS = 1000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type GamePhase = "selecting" | "finished";

export interface PlayerState {
  id: PlayerId;
  /** Ordered queue: index 0 is the top card; won cards join at the end. */
  hand: CardId[];
  /** False once eliminated or forfeited. */
  active: boolean;
}

export interface GameState {
  config: GameConfig;
  phase: GamePhase;
  /** 1-based number of the round currently being played. */
  round: number;
  /** The player who picks the stat this round. */
  leader: PlayerId;
  /** Seat order preserved from config. */
  players: PlayerState[];
  /** Cards carried over from tied rounds / forfeits, oldest first. */
  pot: CardId[];
  winner: PlayerId | null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type Command =
  | { type: "SELECT_STAT"; playerId: PlayerId; stat: StatKey }
  /** Issued by the host when the leader's turn timer expires. */
  | { type: "AUTO_PLAY"; playerId: PlayerId }
  | { type: "FORFEIT"; playerId: PlayerId };

export type CommandRejectionReason =
  | "game-finished"
  | "unknown-player"
  | "player-inactive"
  | "not-leader"
  | "unknown-stat"
  | "stat-not-on-card";

/** Invalid commands are rejected with a reason code and produce no events. */
export class CommandRejectedError extends Error {
  constructor(
    public readonly reason: CommandRejectionReason,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "CommandRejectedError";
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface RevealedCard {
  playerId: PlayerId;
  cardId: CardId;
  /** The card's value for the selected stat (worst-possible if missing). */
  value: number;
}

export type RoundResult =
  { kind: "won"; winner: PlayerId } | { kind: "tie"; tiedPlayers: PlayerId[] };

export type GameEndReason = "last-standing" | "opponents-forfeited" | "round-limit" | "final-tie";

export type GameEvent =
  | {
      type: "GAME_STARTED";
      config: GameConfig;
      firstLeader: PlayerId;
      /** Dealt hands, top card first. */
      hands: Record<PlayerId, CardId[]>;
    }
  | { type: "STAT_SELECTED"; playerId: PlayerId; stat: StatKey; auto: boolean }
  | {
      type: "ROUND_RESOLVED";
      round: number;
      stat: StatKey;
      /** Seat order starting from the round's leader. */
      revealed: RevealedCard[];
      result: RoundResult;
    }
  | { type: "PLAYER_ELIMINATED"; playerId: PlayerId; round: number }
  | { type: "PLAYER_FORFEITED"; playerId: PlayerId }
  | { type: "GAME_ENDED"; winner: PlayerId; reason: GameEndReason };
