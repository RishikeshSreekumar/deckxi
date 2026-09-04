/**
 * The game-mode plugin contract (Phase 9).
 *
 * A mode is everything the platform needs to run one kind of game without
 * knowing its rules: how to set a table up, fold events, apply commands, what
 * a viewer may see, who the clock is waiting on, what the host plays for a
 * player who ran out of time, and how a bot would move. Rooms, the socket
 * layer, persistence, the replay debugger and the admin inspector only ever
 * talk to this interface; nothing above the engine may switch on a mode id.
 *
 * Every hook is pure. No `Math.random()`, no `Date.now()`, no I/O — the same
 * discipline as the trumps engine, for the same reason: a game is its event
 * log, and a log that cannot be replayed is not a record of anything.
 */
import type { CardDefinition, CardId, PlayerId, StatDefinition } from "./types.js";

/** What the host hands every mode at the start of a game. */
export interface ModeSetup {
  /** Seat-ordered player ids. */
  players: PlayerId[];
  /** The cards this table plays with — a draw from the edition. */
  cards: CardDefinition[];
  stats: StatDefinition[];
  /** All randomness in the game derives from this. */
  seed: number;
  /** Trumps: the round cap. Other modes may ignore it. */
  maxRounds?: number;
}

/**
 * The slice of a mode's state the platform reads: for timers, the lobby
 * transition, dashboards and persistence. Everything else stays the mode's.
 */
export interface ModeStatus {
  /** Free-form phase label, for dashboards and logs. */
  phase: string;
  finished: boolean;
  winner: PlayerId | null;
  /**
   * 1-based progress counter (trumps: the round; Squad Draft: the pick),
   * shown by the admin dashboard and stored as the match's `rounds`.
   */
  round: number;
  /** Everyone the table is waiting on right now; empty once finished. */
  waitingOn: PlayerId[];
  /**
   * Identity of the current clock. The host starts one timer per key and
   * leaves it alone while the key holds, so one player answering does not
   * restart the countdown for the rest.
   */
  turnKey: string;
  /** Players still in the game (not forfeited, not eliminated). */
  active: PlayerId[];
}

/**
 * A game mode. `TState`/`TCommand`/`TEvent` are the mode's own engine types;
 * `TView` is the redacted event shape it puts on the wire (declared in
 * `@deckxi/shared`, because the client folds it too).
 */
export interface GameMode<TState, TCommand, TEvent, TView> {
  /** The id rooms store in their settings and the lobby lists. */
  readonly id: string;
  /** Seat limits this mode supports; the room enforces them at start. */
  readonly players: { min: number; max: number };
  /**
   * How many cards to draw from the edition for a table of this size. The
   * host draws at random — the draw is recorded in GAME_STARTED and public.
   */
  deckSize(cardsPerPlayer: number, playerCount: number): number;

  /** Validate the setup and emit the game's first event. */
  init(setup: ModeSetup): TEvent;
  /** `reduce(undefined, first)` is the initial state. */
  reduce(state: TState | undefined, event: TEvent): TState;
  /** Validate a command against the state and emit its consequences. Throws `CommandRejectedError`. */
  apply(state: TState, command: TCommand): TEvent[];
  status(state: TState): ModeStatus;

  /**
   * Turn a client's command payload (already validated against the shared
   * schema) into this player's engine command. Throws `CommandRejectedError`
   * (`unknown-command`) for anything the mode does not speak.
   */
  clientCommand(playerId: PlayerId, payload: unknown): TCommand;
  /** The command the host issues when this player's clock runs out. */
  autoPlay(playerId: PlayerId): TCommand;
  /** The command the host issues when this player leaves the table. */
  forfeit(playerId: PlayerId): TCommand;

  /**
   * Strip what `viewerId` may not see (null = spectator). The wire event is
   * the mode's `TView`; the host adds the sequence number.
   */
  redact(event: TEvent, viewerId: PlayerId | null, editionId: string): TView;

  /** The baseline bot's move for a player, or null when it has none. */
  bot(state: TState, playerId: PlayerId): TCommand | null;

  /**
   * The unredacted state as JSON for operators (the admin inspector, #68).
   * Hands, pools, rosters — everything, because "what does the server think"
   * is the question an inspector exists to answer.
   */
  inspect(state: TState): ModeInspection;
}

/** The operator's view of a running game; `detail` is mode-specific. */
export interface ModeInspection {
  phase: string;
  round: number;
  /** Whose move it is (trumps: the leader; a draft: who is on the clock). */
  leader: PlayerId | null;
  winner: PlayerId | null;
  players: { id: PlayerId; active: boolean; cards: CardId[] }[];
  /** Cards nobody holds right now (trumps: the pot; a draft: the pool). */
  loose: CardId[];
  detail: Record<string, unknown>;
}

/**
 * Type-erased handle the host layer holds. The host never inspects a mode's
 * state — it only threads it back into the same mode's hooks — so the
 * erasure is safe by construction, and the registry is the only place it
 * happens.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameMode = GameMode<any, any, any, any>;
