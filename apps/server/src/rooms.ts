/**
 * Room manager — the in-memory registry of rooms and sessions and all room
 * lifecycle rules (create → join code → lobby → in-game → results → rematch).
 *
 * Transport-agnostic: Socket.IO wiring lives in sockets.ts and observes rooms
 * through the RoomsObserver callbacks, so every rule here is unit-testable
 * without a socket in sight.
 */
import { randomUUID } from "node:crypto";
import { MAX_PLAYERS, MIN_PLAYERS } from "@deckxi/engine";
import { CURRENT_EDITION_ID } from "@deckxi/data";
import type { ErrorCode, RoomPhase, RoomSettings, RoomView } from "@deckxi/shared";
import { generateJoinCode } from "./codes.js";

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

export interface Room {
  id: string;
  code: string;
  phase: RoomPhase;
  hostId: string;
  settings: RoomSettings;
  /** Players in seat order (spectators are not seated). */
  players: Session[];
  spectators: Session[];
  lastActivityAt: number;
}

export type RoomCloseReason = "host-left" | "idle" | "server-shutdown";

/** How the manager talks back to the transport layer. */
export interface RoomsObserver {
  /** Lobby/presence snapshot changed — broadcast to everyone in the room. */
  roomState(room: Room): void;
  roomClosed(room: Room, reason: RoomCloseReason): void;
}

export interface RoomManagerOptions {
  maxRooms?: number;
  /** Rooms with no activity for this long are reaped. */
  idleTimeoutMs?: number;
  maxSpectators?: number;
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

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomIdByCode = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();
  private readonly maxRooms: number;
  private readonly idleTimeoutMs: number;
  private readonly maxSpectators: number;

  constructor(
    private readonly observer: RoomsObserver,
    options: RoomManagerOptions = {},
  ) {
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxSpectators = options.maxSpectators ?? DEFAULT_MAX_SPECTATORS;
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

  createRoom(name: string, settings?: Partial<RoomSettings>): { room: Room; session: Session } {
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
      lastActivityAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
    const session = this.addPlayer(room, name);
    room.hostId = session.id;
    this.observer.roomState(room);
    return { room, session };
  }

  joinRoom(code: string, name: string, wantsSpectator = false): { room: Room; session: Session } {
    const roomId = this.roomIdByCode.get(code);
    const room = roomId === undefined ? undefined : this.rooms.get(roomId);
    if (room === undefined) throw new RoomError("room-not-found", `no room with code ${code}`);

    // Mid-game or full rooms accept spectators only.
    const spectator =
      wantsSpectator || room.phase !== "lobby" || room.players.length >= MAX_PLAYERS;
    if (spectator && room.spectators.length >= this.maxSpectators) {
      throw new RoomError("room-full", "spectator capacity reached");
    }

    const session = spectator ? this.addSpectator(room, name) : this.addPlayer(room, name);
    this.touch(room);
    this.observer.roomState(room);
    return { room, session };
  }

  /** Voluntary leave, or transport-level disconnect in the lobby. */
  leave(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    const room = this.rooms.get(session.roomId);
    this.sessions.delete(sessionId);
    if (room === undefined) return;

    if (session.spectator) {
      room.spectators = room.spectators.filter((s) => s.id !== sessionId);
      this.observer.roomState(room);
      return;
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
    this.rooms.delete(room.id);
    this.roomIdByCode.delete(room.code);
    for (const s of [...room.players, ...room.spectators]) this.sessions.delete(s.id);
    this.observer.roomClosed(room, reason);
  }

  private addPlayer(room: Room, name: string): Session {
    if (room.phase !== "lobby") throw new RoomError("not-in-lobby");
    if (room.players.length >= MAX_PLAYERS) throw new RoomError("room-full");
    const session: Session = {
      id: randomUUID(),
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

  private addSpectator(room: Room, name: string): Session {
    const session: Session = {
      id: randomUUID(),
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
