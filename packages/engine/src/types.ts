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
  /**
   * Optional card metadata some modes read (Squad Draft: role balance and
   * the nation cap). Trumps ignores both — a card is its numbers there.
   */
  role?: string;
  nation?: string;
}

/**
 * Which trumps rule set a game runs under. `classic-trumps` is the plain game
 * (`docs/games/classic-trumps.md`); `power-trumps` adds card choice, the
 * burned-stat rule, rotating lead and the three power cards
 * (`docs/games/power-trumps.md`). Both are variants of the one trumps state
 * machine in this package; other games (Squad Draft) are separate `GameMode`
 * plugins under `modes/`.
 */
export type TrumpsVariant = "classic-trumps" | "power-trumps";

/** Config as supplied by the caller; `maxRounds` defaults to 1000. */
export interface GameConfigInput {
  /** Seat-ordered player list, 2–6 players. */
  players: PlayerId[];
  cards: CardDefinition[];
  stats: StatDefinition[];
  seed: number;
  maxRounds?: number;
  /** Defaults to `classic-trumps`. */
  mode?: TrumpsVariant;
  /** Power trumps: cards off the top to choose from, 1–3 (default 2). Classic is always 1. */
  choiceDepth?: number;
  /** Power trumps: when spent powers come back (default `each-cycle`). Classic is always `never`. */
  powerRecharge?: PowerRecharge;
}

/** Normalised config as stored in the GAME_STARTED event. */
export interface GameConfig extends GameConfigInput {
  maxRounds: number;
  choiceDepth: number;
  powerRecharge: PowerRecharge;
}

export const DEFAULT_MAX_ROUNDS = 1000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Power trumps
// ---------------------------------------------------------------------------

/**
 * The three power cards. Each player holds one of each for the whole game
 * and may declare at most one per round, in the window between the leader's
 * call and the reveal. Every power is the same bet — "my card is strong":
 * it pays big when the round goes your way and costs exactly one extra card
 * when it does not.
 */
export type PowerKind = "powerplay" | "drs" | "super-over";
export const POWER_KINDS: readonly PowerKind[] = ["powerplay", "drs", "super-over"];

/**
 * How many cards off the top a player may choose from each round (power
 * trumps). Two by default (#135: three was too many to compare on a phone
 * under the clock); the host may set one to three. Games recorded before the
 * field existed played with three.
 */
export const DEFAULT_CHOICE_DEPTH = 2;

/**
 * When spent powers come back (#133). `each-cycle`: after every full pass of
 * the deck (deck size ÷ players rounds). `each-elimination`: whenever a seat
 * goes out. `never`: the original one-shot rule. Classic is always `never`.
 */
export type PowerRecharge = "never" | "each-cycle" | "each-elimination";
export const POWER_RECHARGES: readonly PowerRecharge[] = [
  "never",
  "each-cycle",
  "each-elimination",
];
export const DEFAULT_POWER_RECHARGE: PowerRecharge = "each-cycle";
export const MAX_CHOICE_DEPTH = 3;
export const LEGACY_CHOICE_DEPTH = 3;

/** A power as declared with a play. DRS names the stat it overrules with. */
export type PowerPlay =
  { kind: "powerplay" } | { kind: "super-over" } | { kind: "drs"; stat: StatKey };

/** One player's committed play for the round in progress. */
export interface PendingPlay {
  cardId: CardId;
  power: PowerPlay | null;
}

/** The round in progress once the leader has called (power trumps only). */
export interface PendingRound {
  /** Who called — rotation continues from this seat even if they leave. */
  leader: PlayerId;
  /** The leader's call. */
  stat: StatKey;
  /** Committed plays, leader included. */
  plays: Record<PlayerId, PendingPlay>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * `selecting`: waiting on the leader's call. `responding` (power trumps
 * only): the call is in, waiting on every other active player's card.
 */
export type GamePhase = "selecting" | "responding" | "finished";

export interface PlayerState {
  id: PlayerId;
  /** Ordered queue: index 0 is the top card; won cards join at the end. */
  hand: CardId[];
  /** False once eliminated or forfeited. */
  active: boolean;
  /** Unused power cards (always empty in classic trumps). */
  powers: PowerKind[];
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
  /** The stat that decided the previous round (power trumps; informational). */
  lastStat: StatKey | null;
  /**
   * Power trumps (#137): the stats each card has already been called on,
   * keyed by card. A stat burns on the card that named it — the leader's
   * card for the call, the reviewer's card for a DRS — and stays burned on
   * that card alone, so the same card cannot win twice on its one big
   * number while every other card keeps its whole sheet. A card with
   * nothing left un-burned opens up again (spec edge case 1).
   */
  burnedByCard: Record<CardId, StatKey[]>;
  /** The round in progress, from the leader's call until the reveal (power trumps). */
  pending: PendingRound | null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type Command =
  | {
      type: "SELECT_STAT";
      playerId: PlayerId;
      stat: StatKey;
      /** Power trumps: which of the top cards to play (0 = top). Default 0. */
      cardIndex?: number;
      /** Power trumps: a power declared with the call (never DRS). */
      power?: PowerPlay | null;
    }
  /** Power trumps: a non-leader's answer to the call. */
  | {
      type: "PLAY_CARD";
      playerId: PlayerId;
      cardIndex: number;
      power?: PowerPlay | null;
    }
  /**
   * Issued by the host when a turn timer expires: the leader's best stat on
   * their top card, or (power trumps, responding) a responder's top card
   * with no power.
   */
  | { type: "AUTO_PLAY"; playerId: PlayerId }
  | { type: "FORFEIT"; playerId: PlayerId };

export type CommandRejectionReason =
  | "game-finished"
  | "unknown-player"
  | "player-inactive"
  | "not-leader"
  | "unknown-stat"
  | "stat-not-on-card"
  | "stat-burned"
  | "bad-card-index"
  | "not-responding"
  | "already-played"
  | "power-unavailable"
  | "power-not-allowed"
  /** A command this game mode does not understand (wrong mode, or a bad payload). */
  | "unknown-command"
  // Squad Draft (docs/games/squad-draft.md)
  | "not-on-the-clock"
  | "card-not-in-pool"
  | "nation-cap"
  | "not-building"
  | "already-submitted"
  | "invalid-roster";

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

/** `void`: the power could not apply (a Super Over on a tie) and is handed back. */
export type PowerOutcomeKind = "won" | "lost" | "void";

export interface PowerOutcome {
  playerId: PlayerId;
  power: PowerKind;
  outcome: PowerOutcomeKind;
}

/** One card changing hands after the reveal; `pot` is a valid end. */
export interface CardTransfer {
  cardId: CardId;
  from: PlayerId | "pot";
  to: PlayerId | "pot";
}

/** A Super Over: the challenger's next card against the pot holder's. */
export interface SuperOverResult {
  challenger: PlayerId;
  defender: PlayerId;
  challengerCard: RevealedCard;
  defenderCard: RevealedCard;
  /** Null on a tie (the challenger loses the bet). */
  winner: PlayerId | null;
}

/**
 * What the powers did to the round (power trumps only). The reducer applies
 * `transfers` verbatim, after the reveal has been settled the classic way.
 */
export interface PowerRound {
  /** The leader's call; `stat` on the event is the stat that actually decided it. */
  calledStat: StatKey;
  /** Who overruled the call, if anyone. */
  drsBy: PlayerId | null;
  outcomes: PowerOutcome[];
  superOvers: SuperOverResult[];
  transfers: CardTransfer[];
  /** Who calls next: rotation, or the DRS winner. */
  nextLeader: PlayerId;
}

export type GameEvent =
  | {
      type: "GAME_STARTED";
      config: GameConfig;
      firstLeader: PlayerId;
      /** Dealt hands, top card first. */
      hands: Record<PlayerId, CardId[]>;
    }
  | {
      type: "STAT_SELECTED";
      playerId: PlayerId;
      stat: StatKey;
      auto: boolean;
      /** Power trumps: the card the leader committed and the power declared. */
      cardId?: CardId;
      power?: PowerPlay | null;
    }
  /** Power trumps: a non-leader has answered the call. */
  | {
      type: "CARD_PLAYED";
      playerId: PlayerId;
      cardId: CardId;
      power: PowerPlay | null;
      auto: boolean;
    }
  | {
      type: "ROUND_RESOLVED";
      round: number;
      stat: StatKey;
      /** Seat order starting from the round's leader. */
      revealed: RevealedCard[];
      result: RoundResult;
      /** Present in power trumps only. */
      power?: PowerRound;
    }
  | { type: "PLAYER_ELIMINATED"; playerId: PlayerId; round: number }
  /** Power trumps (#133): every active player holds all three powers again. */
  | { type: "POWERS_RECHARGED"; round: number }
  | { type: "PLAYER_FORFEITED"; playerId: PlayerId }
  | { type: "GAME_ENDED"; winner: PlayerId; reason: GameEndReason };
