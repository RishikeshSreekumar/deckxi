/**
 * Room manager — the in-memory registry of rooms and sessions and all room
 * lifecycle rules (create → join code → lobby → in-game → results → rematch).
 *
 * Transport-agnostic: Socket.IO wiring lives in sockets.ts and observes rooms
 * through the RoomsObserver callbacks, so every rule here is unit-testable
 * without a socket in sight.
 */
import { randomInt, randomUUID } from "node:crypto";
import {
  applyCommand,
  CommandRejectedError,
  initGame,
  MAX_PLAYERS,
  MIN_PLAYERS,
  reduceAll,
  type CardDefinition,
  type Command,
  type GameState,
  type StatDefinition,
} from "@deckxi/engine";
import { CURRENT_EDITION_ID, loadEdition } from "@deckxi/data";
import type { ErrorCode, RoomPhase, RoomSettings, RoomView, TurnTimerView } from "@deckxi/shared";
import { generateJoinCode } from "./codes.js";
import type { SeqEvent } from "./redact.js";
import { InMemoryMatchStore, type MatchStore } from "./store.js";

export class RoomError extends Error {
  constructor(
    public readonly code: ErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "RoomError";
  }
}

export interface Session {
  /** Globally unique; doubles as the engine PlayerId once a game starts. */
  id: string;
  /** The signed-in account (guest or full) behind this seat; null for
   *  cookie-less connections (bots, pre-auth clients). */
  userId: string | null;
  name: string;
  roomId: string;
  spectator: boolean;
  /** Seat order for players; -1 for spectators. */
  seat: number;
  ready: boolean;
  connected: boolean;
  /** Opaque secret the client presents to room:resume. */
  resumeToken: string;
}

/** A running (or just-finished) game inside a room. */
export interface GameInstance {
  matchId: string;
  editionId: string;
  state: GameState;
  /** Full, unredacted event log — server truth; redacted per viewer on send. */
  log: SeqEvent[];
  startedAt: number;
  /** Epoch ms when the current leader is auto-played; null when finished. */
  turnDeadline: number | null;
  turnTimer: NodeJS.Timeout | null;
}

export interface Room {
  id: string;
  code: string;
  phase: RoomPhase;
  hostId: string;
  settings: RoomSettings;
  /** Players in seat order (spectators are not seated). */
  players: Session[];
  spectators: Session[];
  game: GameInstance | null;
  lastActivityAt: number;
}

export type RoomCloseReason = "host-left" | "idle" | "server-shutdown";

/** How the manager talks back to the transport layer. */
export interface RoomsObserver {
  /** Lobby/presence snapshot changed — broadcast to everyone in the room. */
  roomState(room: Room): void;
  roomClosed(room: Room, reason: RoomCloseReason): void;
  /** New engine events appended — transport redacts per viewer and delivers. */
  gameEvents(room: Room, events: SeqEvent[]): void;
  /** Turn timer armed (or cleared, when the game ends). */
  timer(room: Room, timer: TurnTimerView | null): void;
}

export interface RoomManagerOptions {
  maxRooms?: number;
  /** Rooms with no activity for this long are reaped. */
  idleTimeoutMs?: number;
  maxSpectators?: number;
  /** Test hook: fixed turn length instead of the room's setting. */
  turnTimerMsOverride?: number;
  /** How long a mid-game player may stay disconnected before forfeiting. */
  disconnectGraceMs?: number;
  /** Where event logs and match results are persisted (default: in-memory). */
  store?: MatchStore;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  gameMode: "classic-trumps",
  editionId: CURRENT_EDITION_ID,
  cardsPerPlayer: 5,
  turnTimerSeconds: 20,
  maxRounds: 100,
};

const DEFAULT_MAX_ROOMS = 200;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SPECTATORS = 20;
const DEFAULT_DISCONNECT_GRACE_MS = 60 * 1000;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomIdByCode = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly maxRooms: number;
  private readonly idleTimeoutMs: number;
  private readonly maxSpectators: number;
  private readonly turnTimerMsOverride: number | undefined;
  private readonly disconnectGraceMs: number;
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly store: MatchStore;

  constructor(
    private readonly observer: RoomsObserver,
    options: RoomManagerOptions = {},
  ) {
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxSpectators = options.maxSpectators ?? DEFAULT_MAX_SPECTATORS;
    this.turnTimerMsOverride = options.turnTimerMsOverride;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.store = options.store ?? new InMemoryMatchStore();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  createRoom(
    name: string,
    settings?: Partial<RoomSettings>,
    userId: string | null = null,
  ): { room: Room; session: Session } {
    if (this.rooms.size >= this.maxRooms) {
      throw new RoomError("server-full", "no capacity for new rooms");
    }
    const room: Room = {
      id: randomUUID(),
      code: generateJoinCode(new Set(this.roomIdByCode.keys())),
      phase: "lobby",
      hostId: "",
      settings: { ...DEFAULT_SETTINGS, ...settings },
      players: [],
      spectators: [],
      game: null,
      lastActivityAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
    const session = this.addPlayer(room, name, userId);
    room.hostId = session.id;
    this.observer.roomState(room);
    return { room, session };
  }

  joinRoom(
    code: string,
    name: string,
    wantsSpectator = false,
    userId: string | null = null,
  ): { room: Room; session: Session } {
    const roomId = this.roomIdByCode.get(code);
    const room = roomId === undefined ? undefined : this.rooms.get(roomId);
    if (room === undefined) throw new RoomError("room-not-found", `no room with code ${code}`);

    // Mid-game or full rooms accept spectators only.
    const spectator =
      wantsSpectator || room.phase !== "lobby" || room.players.length >= MAX_PLAYERS;
    if (spectator && room.spectators.length >= this.maxSpectators) {
      throw new RoomError("room-full", "spectator capacity reached");
    }

    const session = spectator
      ? this.addSpectator(room, name, userId)
      : this.addPlayer(room, name, userId);
    this.touch(room);
    this.observer.roomState(room);
    return { room, session };
  }

  /**
   * The transport lost this session's socket. Mid-game players get a grace
   * window to reconnect (the turn timer auto-plays them meanwhile); everyone
   * else just leaves.
   */
  handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const room = this.rooms.get(session.roomId);
    if (room === undefined) return;

    // Grace only matters while a game runs; lobby/results members just leave
    // (they can rejoin by code). Spectators get grace too — they hold no seat.
    if (room.phase !== "playing") {
      this.leave(sessionId);
      return;
    }

    session.connected = false;
    this.clearGrace(sessionId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(sessionId);
      if (this.sessions.get(sessionId)?.connected === false) this.leave(sessionId);
    }, this.disconnectGraceMs);
    timer.unref();
    this.graceTimers.set(sessionId, timer);
    this.observer.roomState(room);
  }

  /**
   * Reconnect: the client presents its resume token and gets its session
   * back; the caller replays the redacted event log to rebuild client state.
   */
  resume(roomId: string, resumeToken: string): { room: Room; session: Session } {
    const room = this.rooms.get(roomId);
    if (room === undefined) throw new RoomError("resume-failed", "room is gone");
    const session = [...room.players, ...room.spectators].find(
      (s) => s.resumeToken === resumeToken,
    );
    if (session === undefined) {
      throw new RoomError("resume-failed", "no session for this token (grace may have expired)");
    }
    this.clearGrace(session.id);
    session.connected = true;
    this.touch(room);
    this.observer.roomState(room);
    return { room, session };
  }

  /** Voluntary leave, or transport-level disconnect in the lobby. */
  leave(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.clearGrace(sessionId);
    const room = this.rooms.get(session.roomId);
    this.sessions.delete(sessionId);
    if (room === undefined) return;

    if (session.spectator) {
      room.spectators = room.spectators.filter((s) => s.id !== sessionId);
      this.observer.roomState(room);
      return;
    }

    // Leaving mid-game is a forfeit — the engine decides the consequences.
    if (
      room.phase === "playing" &&
      room.game?.state.players.some((p) => p.id === sessionId && p.active) === true
    ) {
      try {
        this.applyEngineCommand(room, { type: "FORFEIT", playerId: sessionId });
      } catch {
        // Game already over or command rejected — removal proceeds regardless.
      }
    }

    room.players = room.players.filter((s) => s.id !== sessionId);
    if (room.players.length === 0) {
      this.closeRoom(room, "host-left");
      return;
    }
    if (room.hostId === sessionId) {
      room.hostId = (room.players[0] as Session).id;
    }
    this.touch(room);
    this.observer.roomState(room);
  }

  setReady(sessionId: string, ready: boolean): void {
    const { room, session } = this.requirePlayer(sessionId);
    if (room.phase !== "lobby") throw new RoomError("not-in-lobby");
    session.ready = ready;
    this.touch(room);
    this.observer.roomState(room);
  }

  updateSettings(sessionId: string, patch: Partial<RoomSettings>): void {
    const { room, session } = this.requirePlayer(sessionId);
    if (room.hostId !== session.id) throw new RoomError("not-host");
    if (room.phase !== "lobby") throw new RoomError("not-in-lobby");
    room.settings = { ...room.settings, ...patch };
    this.touch(room);
    this.observer.roomState(room);
  }

  // -------------------------------------------------------------------------
  // Game loop (authoritative: clients send commands, engine decides)
  // -------------------------------------------------------------------------

  startGame(sessionId: string): void {
    const { room, session } = this.requirePlayer(sessionId);
    if (room.hostId !== session.id) throw new RoomError("not-host");
    if (room.phase !== "lobby") throw new RoomError("not-in-lobby");
    if (room.players.length < MIN_PLAYERS) {
      throw new RoomError("not-enough-players", `need at least ${MIN_PLAYERS} players`);
    }
    const notReady = room.players.filter((p) => p.id !== room.hostId && !p.ready);
    if (notReady.length > 0) {
      throw new RoomError("players-not-ready", notReady.map((p) => p.name).join(", "));
    }

    const { cards, stats } = buildDeck(room.settings, room.players.length);
    const started = initGame({
      players: room.players.map((p) => p.id),
      cards,
      stats,
      seed: randomInt(2 ** 31),
      maxRounds: room.settings.maxRounds,
    });

    room.game = {
      matchId: randomUUID(),
      editionId: room.settings.editionId,
      state: reduceAll([started]),
      log: [{ seq: 0, event: started }],
      startedAt: Date.now(),
      turnDeadline: null,
      turnTimer: null,
    };
    room.phase = "playing";
    this.touch(room);

    const game = room.game;
    this.persist("createMatch", async () => {
      await this.store.createMatch({
        matchId: game.matchId,
        roomId: room.id,
        roomCode: room.code,
        editionId: game.editionId,
        gameMode: room.settings.gameMode,
        startedAt: new Date(game.startedAt),
        players: room.players.map((p) => ({
          sessionId: p.id,
          userId: p.userId,
          name: p.name,
          seat: p.seat,
        })),
      });
      await this.store.appendEvents(game.matchId, game.log);
    });

    this.observer.roomState(room);
    this.observer.gameEvents(room, room.game.log);
    this.scheduleTurn(room);
  }

  selectStat(sessionId: string, stat: string): void {
    const { room, session } = this.requirePlayer(sessionId);
    this.applyEngineCommand(room, { type: "SELECT_STAT", playerId: session.id, stat });
  }

  forfeit(sessionId: string): void {
    const { room, session } = this.requirePlayer(sessionId);
    this.applyEngineCommand(room, { type: "FORFEIT", playerId: session.id });
  }

  /** Host resets a finished room back to the lobby for another game. */
  rematch(sessionId: string): void {
    const { room, session } = this.requirePlayer(sessionId);
    if (room.hostId !== session.id) throw new RoomError("not-host");
    if (room.phase !== "results") throw new RoomError("game-not-running", "no finished game");
    if (room.game !== null) this.clearTurn(room.game);
    room.game = null;
    room.phase = "lobby";
    for (const p of room.players) p.ready = false;
    this.touch(room);
    this.observer.roomState(room);
  }

  protected applyEngineCommand(room: Room, command: Command): void {
    if (room.phase !== "playing" || room.game === null) {
      throw new RoomError("game-not-running");
    }
    const game = room.game;
    let events;
    try {
      events = applyCommand(game.state, command);
    } catch (error) {
      if (error instanceof CommandRejectedError) {
        throw new RoomError("command-rejected", error.reason);
      }
      throw error;
    }

    let seq = (game.log.at(-1)?.seq ?? -1) + 1;
    const appended: SeqEvent[] = events.map((event) => ({ seq: seq++, event }));
    game.log.push(...appended);
    game.state = reduceAll(events, game.state);
    this.touch(room);
    this.persist("appendEvents", () => this.store.appendEvents(game.matchId, appended));
    this.observer.gameEvents(room, appended);

    if (game.state.phase === "finished") {
      this.clearTurn(game);
      room.phase = "results";
      const ended = appended.find((e) => e.event.type === "GAME_ENDED")?.event;
      this.persist("finishMatch", () =>
        this.store.finishMatch(game.matchId, {
          finishedAt: new Date(),
          winnerSessionId: game.state.winner ?? "",
          endReason: ended?.type === "GAME_ENDED" ? ended.reason : "unknown",
          rounds: game.state.round - 1,
        }),
      );
      this.observer.timer(room, null);
      this.observer.roomState(room);
    } else {
      this.scheduleTurn(room);
    }
  }

  /** Persistence is fire-and-forget: a store outage must never stall play. */
  private persist(label: string, write: () => Promise<void>): void {
    write().catch((error: unknown) => {
      console.error(`[store] ${label} failed:`, error);
    });
  }

  // -------------------------------------------------------------------------
  // Turn timers — the server auto-plays leaders who run out of time, so a
  // stalled (or disconnected) player never blocks the table.
  // -------------------------------------------------------------------------

  protected scheduleTurn(room: Room): void {
    const game = room.game;
    if (game === null || room.phase !== "playing") return;
    this.clearTurn(game);
    const durationMs = this.turnTimerMsOverride ?? room.settings.turnTimerSeconds * 1000;
    const leader = game.state.leader;
    const deadline = Date.now() + durationMs;
    game.turnDeadline = deadline;
    game.turnTimer = setTimeout(() => this.onTurnExpired(room.id, leader, deadline), durationMs);
    game.turnTimer.unref();
    this.observer.timer(room, { playerId: leader, deadline });
  }

  private onTurnExpired(roomId: string, leader: string, deadline: number): void {
    const room = this.rooms.get(roomId);
    const game = room?.game;
    if (room === undefined || game === null || game === undefined) return;
    // Stale timer (a command landed and rescheduled, or the game ended).
    if (
      room.phase !== "playing" ||
      game.turnDeadline !== deadline ||
      game.state.leader !== leader
    ) {
      return;
    }
    try {
      this.applyEngineCommand(room, { type: "AUTO_PLAY", playerId: leader });
    } catch {
      // The engine refused (e.g. a race with game end); nothing to do.
    }
  }

  protected clearTurn(game: GameInstance): void {
    if (game.turnTimer !== null) clearTimeout(game.turnTimer);
    game.turnTimer = null;
    game.turnDeadline = null;
  }

  private clearGrace(sessionId: string): void {
    const timer = this.graceTimers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    this.graceTimers.delete(sessionId);
  }

  /** Reap rooms idle past the timeout. Returns how many were closed. */
  reapIdle(now: number = Date.now()): number {
    let reaped = 0;
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivityAt > this.idleTimeoutMs) {
        this.closeRoom(room, "idle");
        reaped++;
      }
    }
    return reaped;
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room, "server-shutdown");
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  protected touch(room: Room): void {
    room.lastActivityAt = Date.now();
  }

  protected requireSession(sessionId: string): { room: Room; session: Session } {
    const session = this.sessions.get(sessionId);
    const room = session === undefined ? undefined : this.rooms.get(session.roomId);
    if (session === undefined || room === undefined) throw new RoomError("not-in-room");
    return { room, session };
  }

  protected requirePlayer(sessionId: string): { room: Room; session: Session } {
    const found = this.requireSession(sessionId);
    if (found.session.spectator) throw new RoomError("spectators-cannot");
    return found;
  }

  protected closeRoom(room: Room, reason: RoomCloseReason): void {
    if (room.game !== null) this.clearTurn(room.game);
    this.rooms.delete(room.id);
    this.roomIdByCode.delete(room.code);
    for (const s of [...room.players, ...room.spectators]) {
      this.clearGrace(s.id);
      this.sessions.delete(s.id);
    }
    this.observer.roomClosed(room, reason);
  }

  private addPlayer(room: Room, name: string, userId: string | null = null): Session {
    if (room.phase !== "lobby") throw new RoomError("not-in-lobby");
    if (room.players.length >= MAX_PLAYERS) throw new RoomError("room-full");
    const session: Session = {
      id: randomUUID(),
      userId,
      name,
      roomId: room.id,
      spectator: false,
      // Next free seat — stays unique even after mid-lobby departures.
      seat: room.players.reduce((max, p) => Math.max(max, p.seat), -1) + 1,
      ready: false,
      connected: true,
      resumeToken: randomUUID(),
    };
    room.players.push(session);
    this.sessions.set(session.id, session);
    return session;
  }

  private addSpectator(room: Room, name: string, userId: string | null = null): Session {
    const session: Session = {
      id: randomUUID(),
      userId,
      name,
      roomId: room.id,
      spectator: true,
      seat: -1,
      ready: false,
      connected: true,
      resumeToken: randomUUID(),
    };
    room.spectators.push(session);
    this.sessions.set(session.id, session);
    return session;
  }
}

/**
 * Draw this game's deck: a random subset of the edition's cards sized
 * `cardsPerPlayer × players`, plus the edition's stat definitions in engine
 * form. Server-side randomness is fine — the chosen deck is recorded in
 * GAME_STARTED and public.
 */
function buildDeck(
  settings: RoomSettings,
  playerCount: number,
): { cards: CardDefinition[]; stats: StatDefinition[] } {
  const edition = loadEdition(settings.editionId);
  const pool = [...edition.players];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = pool[i] as (typeof pool)[number];
    pool[i] = pool[j] as (typeof pool)[number];
    pool[j] = a;
  }
  const deckSize = Math.min(pool.length, settings.cardsPerPlayer * playerCount);
  return {
    cards: pool.slice(0, deckSize).map((p) => ({ id: p.id, stats: { ...p.stats } })),
    stats: edition.stats.map((s) => ({
      key: s.key,
      direction: s.direction,
      min: s.min,
      max: s.max,
    })),
  };
}

export function toRoomView(room: Room): RoomView {
  return {
    roomId: room.id,
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      ready: p.ready,
      connected: p.connected,
    })),
    spectators: room.spectators.map((s) => ({ id: s.id, name: s.name })),
  };
}

export { MAX_PLAYERS, MIN_PLAYERS };
