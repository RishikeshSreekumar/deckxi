/**
 * Offline practice (#85): the game with no server in it.
 *
 * The engine is pure and the edition is already bundled for card display, so
 * everything a game needs is in the browser. This module is the host the
 * server usually is — it draws a deck, seats bots, applies commands, folds
 * events and redacts them for the one viewer who exists. The store hands it
 * the same actions it would otherwise emit over the socket, so the table,
 * the reveal presenter and the results screen never learn there is no room.
 *
 * Deliberately narrower than the server:
 *   - No clock. A practice game with nobody waiting has nothing to hurry for,
 *     and a countdown you cannot lose to is theatre.
 *   - No chat, no persistence, no rating. Nothing here leaves the device.
 *   - Trumps only. Squad Draft is a drafting game against opponents whose
 *     picks are the point; the baseline bot would make it a solitaire.
 *
 * Bots move as soon as it is their turn, in one synchronous burst, exactly as
 * `runBotGame` does — the reveal presenter is what paces the table, not the
 * arrival of events.
 */
import { getMode, type AnyGameMode } from "@deckxi/engine";
import { DEFAULT_EDITION_ID, getEdition } from "@deckxi/ui";
import type {
  GameCommandPayload,
  GameModeId,
  RoomSettings,
  RoomView,
  WireGameEvent,
} from "@deckxi/shared";

/** Seats you plus this many bots; three is the shape most tables have. */
export const PRACTICE_BOTS = 2;

export const PRACTICE_ROOM_ID = "practice";
/** Shown where a real room shows its invite code — nobody can join this one. */
export const PRACTICE_CODE = "SOLO";

export const PRACTICE_SELF_ID = "practice-you";

const BOT_NAMES = ["Nightwatch", "Cover Drive", "Googly", "Yorker", "Slip Cordon"] as const;

/** Modes practice can host. Squad Draft needs opponents worth drafting against. */
export const PRACTICE_MODES: readonly GameModeId[] = ["classic-trumps", "power-trumps"];

export interface PracticeOptions {
  gameMode: GameModeId;
  /** Your name at the table. */
  name: string;
  bots?: number;
  /** Injected by tests; production uses `Math.random`. */
  seed?: number;
}

export interface PracticeTable {
  room: RoomView;
  selfId: string;
  /** Redacted for you, sequence-numbered — exactly what the socket would send. */
  events: WireGameEvent[];
}

interface PracticeGame {
  mode: AnyGameMode;
  state: unknown;
  seq: number;
  editionId: string;
}

/** The live practice game, if one is running. One table per device. */
let current: PracticeGame | null = null;

export function practiceRunning(): boolean {
  return current !== null;
}

export function endPractice(): void {
  current = null;
}

/**
 * Draw this game's deck from the bundled edition. The server does the same
 * from disk; the draw is public either way (it is recorded in GAME_STARTED),
 * so browser randomness costs us nothing.
 */
function buildDeck(settings: RoomSettings, mode: AnyGameMode, players: number, rand: () => number) {
  const edition = getEdition(settings.editionId);
  if (edition === null) throw new Error(`edition not bundled: ${settings.editionId}`);
  const pool = [...edition.players];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = pool[i] as (typeof pool)[number];
    pool[i] = pool[j] as (typeof pool)[number];
    pool[j] = a;
  }
  const size = Math.min(pool.length, mode.deckSize(settings.cardsPerPlayer, players));
  return {
    cards: pool.slice(0, size).map((p) => ({
      id: p.id,
      stats: { ...p.stats },
      role: p.role,
      nation: p.nationality,
    })),
    stats: edition.stats.map((s) => ({
      key: s.key,
      direction: s.direction,
      min: s.min,
      max: s.max,
    })),
  };
}

function practiceSettings(gameMode: GameModeId): RoomSettings {
  return {
    gameMode,
    editionId: DEFAULT_EDITION_ID,
    cardsPerPlayer: 5,
    // No clock offline: nothing is waiting on you. The table reads the room's
    // settings for copy, and 0 would fail the shared schema, so it keeps a
    // plausible value and simply never starts a timer.
    turnTimerSeconds: 20,
    maxRounds: 100,
  };
}

function botId(index: number): string {
  return `practice-bot-${index}`;
}

/** Start a practice game and return everything the store needs to show it. */
export function startPractice(options: PracticeOptions): PracticeTable {
  const bots = options.bots ?? PRACTICE_BOTS;
  const settings = practiceSettings(options.gameMode);
  const mode = getMode(settings.gameMode);
  const players = [
    { id: PRACTICE_SELF_ID, name: options.name.trim() === "" ? "You" : options.name.trim() },
    ...Array.from({ length: bots }, (_, i) => ({
      id: botId(i),
      name: BOT_NAMES[i % BOT_NAMES.length] as string,
    })),
  ];

  const rand = options.seed === undefined ? Math.random : mulberry(options.seed);
  const { cards, stats } = buildDeck(settings, mode, players.length, rand);
  const started = mode.init({
    players: players.map((p) => p.id),
    cards,
    stats,
    seed: Math.floor(rand() * 2 ** 31),
    maxRounds: settings.maxRounds,
  });

  current = {
    mode,
    state: mode.reduce(undefined, started),
    seq: 0,
    editionId: settings.editionId,
  };

  const room: RoomView = {
    roomId: PRACTICE_ROOM_ID,
    code: PRACTICE_CODE,
    phase: "playing",
    hostId: PRACTICE_SELF_ID,
    settings,
    players: players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      seat,
      ready: true,
      connected: true,
    })),
    spectators: [],
  };

  const events = [wire(current, started), ...runBots(current)];
  return { room, selfId: PRACTICE_SELF_ID, events };
}

/** Apply your move, then let the bots answer. Throws like the server rejects. */
export function practiceCommand(payload: GameCommandPayload): WireGameEvent[] {
  const game = requireGame();
  const command = game.mode.clientCommand(PRACTICE_SELF_ID, payload);
  return [...apply(game, command), ...runBots(game)];
}

/** Leaving a practice game mid-way: the same forfeit the server would apply. */
export function practiceForfeit(): WireGameEvent[] {
  const game = requireGame();
  return [...apply(game, game.mode.forfeit(PRACTICE_SELF_ID)), ...runBots(game)];
}

/** True once the engine says the game is over — the store flips to results. */
export function practiceFinished(): boolean {
  return current === null ? false : current.mode.status(current.state).finished;
}

function requireGame(): PracticeGame {
  if (current === null) throw new Error("no practice game is running");
  return current;
}

function apply(game: PracticeGame, command: unknown): WireGameEvent[] {
  const events = game.mode.apply(game.state, command);
  const out: WireGameEvent[] = [];
  for (const event of events) {
    out.push(wire(game, event));
    game.state = game.mode.reduce(game.state, event);
  }
  return out;
}

function wire(game: PracticeGame, event: unknown): WireGameEvent {
  const seq = game.seq++;
  return {
    seq,
    ...(game.mode.redact(event, PRACTICE_SELF_ID, game.editionId) as object),
  } as WireGameEvent;
}

/**
 * Play every bot that is on the clock until the table is waiting on you (or
 * the game ends). The cap is the same belt-and-braces guard `runBotGame`
 * uses: a rule bug should fail the table, not hang the tab.
 */
function runBots(game: PracticeGame): WireGameEvent[] {
  const events: WireGameEvent[] = [];
  for (let i = 0; i < 500; i++) {
    const status = game.mode.status(game.state);
    if (status.finished) break;
    const next = status.waitingOn.find((id) => id !== PRACTICE_SELF_ID);
    if (next === undefined) break;
    // `mode.bot` is the plugin contract; baselineBot is what trumps puts
    // behind it. A mode with no bot cannot be practised against, and we
    // stop rather than loop forever waiting for a move nobody will make.
    const command = game.mode.bot(game.state, next);
    if (command === null) break;
    events.push(...apply(game, command));
  }
  return events;
}

/** Seeded PRNG for tests, so a practice game can be asserted move by move. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
