/**
 * Socket protocol — the versioned, Zod-validated contract between the web
 * client and the realtime server.
 *
 * Every client→server message has a schema here and is validated on arrival;
 * the server answers via a per-message ack (`Ack<T>`). Server→client pushes
 * are typed by `ServerToClientEvents`. Game events on the wire are *redacted*:
 * a client only ever sees its own hand and everyone's card counts — the deal
 * and the RNG seed never leave the server (anti-cheat by construction).
 */
import { z } from "zod";

/** Bumped on any breaking change; the handshake rejects mismatched clients. */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives & limits
// ---------------------------------------------------------------------------

export const JOIN_CODE_LENGTH = 6;
/** Unambiguous alphabet for join codes (no 0/O/1/I). */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const MAX_NAME_LENGTH = 24;
export const MAX_CHAT_LENGTH = 280;

export const EMOTES = ["👏", "😂", "😮", "🔥", "😭", "🏏"] as const;

export const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "no control characters");

export const joinCodeSchema = z
  .string()
  .length(JOIN_CODE_LENGTH)
  .transform((s) => s.toUpperCase())
  .refine((s) => [...s].every((c) => JOIN_CODE_ALPHABET.includes(c)), {
    message: "invalid join code",
  });

// ---------------------------------------------------------------------------
// Room settings (host-editable in the lobby)
// ---------------------------------------------------------------------------

export const roomSettingsSchema = z.object({
  gameMode: z.literal("classic-trumps"),
  /** Edition the game's deck is drawn from; pinned at game start. */
  editionId: z.string().regex(/^edition-\d{4}-q[1-4]$/),
  /** Cards dealt per player; the deck is a random edition subset of size n×players. */
  cardsPerPlayer: z.number().int().min(3).max(11),
  turnTimerSeconds: z.number().int().min(5).max(120),
  maxRounds: z.number().int().min(10).max(1000),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export const roomSettingsPatchSchema = roomSettingsSchema.partial();

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

export const createRoomSchema = z.object({
  name: playerNameSchema,
  settings: roomSettingsPatchSchema.optional(),
});

export const joinRoomSchema = z.object({
  code: joinCodeSchema,
  name: playerNameSchema,
  /** Join read-only; also forced when the room is full or in-game. */
  spectator: z.boolean().optional(),
});

export const resumeRoomSchema = z.object({
  roomId: z.string().min(1).max(64),
  resumeToken: z.string().min(1).max(128),
});

export const setReadySchema = z.object({ ready: z.boolean() });

export const selectStatSchema = z.object({
  stat: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
});

export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CHAT_LENGTH),
});

export const chatReactSchema = z.object({ emote: z.enum(EMOTES) });

export const emptySchema = z.object({}).optional();

/** Schema per inbound event name — the server's validation table. */
export const clientMessageSchemas = {
  "room:create": createRoomSchema,
  "room:join": joinRoomSchema,
  "room:resume": resumeRoomSchema,
  "room:leave": emptySchema,
  "room:ready": setReadySchema,
  "room:settings": roomSettingsPatchSchema,
  "room:start": emptySchema,
  "room:rematch": emptySchema,
  "game:selectStat": selectStatSchema,
  "game:forfeit": emptySchema,
  "chat:send": chatSendSchema,
  "chat:react": chatReactSchema,
} as const;
export type ClientMessageName = keyof typeof clientMessageSchemas;

// ---------------------------------------------------------------------------
// Acks & errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "bad-request",
  "protocol-mismatch",
  "room-not-found",
  "room-full",
  "already-in-room",
  "not-in-room",
  "not-host",
  "not-in-lobby",
  "not-enough-players",
  "players-not-ready",
  "game-not-running",
  "command-rejected",
  "rate-limited",
  "spectators-cannot",
  "resume-failed",
  "server-full",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Ack<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Snapshots (server → client)
// ---------------------------------------------------------------------------

export type RoomPhase = "lobby" | "playing" | "results";

export interface RoomPlayerView {
  id: string;
  name: string;
  /** Seat order; assigned on join, stable for the room's life. */
  seat: number;
  ready: boolean;
  connected: boolean;
}

export interface SpectatorView {
  id: string;
  name: string;
}

export interface RoomView {
  roomId: string;
  code: string;
  phase: RoomPhase;
  hostId: string;
  settings: RoomSettings;
  players: RoomPlayerView[];
  spectators: SpectatorView[];
}

/** Ack payload for room:create / room:join. */
export interface RoomJoined {
  protocolVersion: number;
  roomId: string;
  /** Your identity in this room (also your engine PlayerId when playing). */
  selfId: string;
  spectator: boolean;
  /** Opaque token for room:resume after a disconnect. */
  resumeToken: string;
  room: RoomView;
}

/** Ack payload for room:resume — snapshot plus your redacted event log. */
export interface RoomResumed extends RoomJoined {
  /** Redacted log of the game in progress (empty in lobby/results). */
  events: RedactedGameEvent[];
  /** Current turn deadline, if a turn timer is running. */
  timer: TurnTimerView | null;
}

// ---------------------------------------------------------------------------
// Redacted game events (server → client)
// ---------------------------------------------------------------------------

export interface RedactedGameConfig {
  players: string[];
  /** Full definitions of every card in play — public edition data. */
  cards: { id: string; stats: Record<string, number> }[];
  stats: { key: string; direction: "higher" | "lower"; min: number; max: number }[];
  maxRounds: number;
  editionId: string;
}

export interface RevealedCardView {
  playerId: string;
  cardId: string;
  value: number;
}

export type RoundResultView =
  { kind: "won"; winner: string } | { kind: "tie"; tiedPlayers: string[] };

/**
 * Engine events with hidden information stripped per viewer. GAME_STARTED
 * carries your own hand plus card counts; the seed and other hands never
 * appear. Every event carries the server-assigned sequence number so
 * reconnection can replay deterministically.
 */
export type RedactedGameEvent = { seq: number } & (
  | {
      type: "GAME_STARTED";
      config: RedactedGameConfig;
      firstLeader: string;
      /** Your dealt hand, top card first; null for spectators. */
      yourHand: string[] | null;
      handCounts: Record<string, number>;
    }
  | { type: "STAT_SELECTED"; playerId: string; stat: string; auto: boolean }
  | {
      type: "ROUND_RESOLVED";
      round: number;
      stat: string;
      revealed: RevealedCardView[];
      result: RoundResultView;
    }
  | { type: "PLAYER_ELIMINATED"; playerId: string; round: number }
  | { type: "PLAYER_FORFEITED"; playerId: string }
  | {
      type: "GAME_ENDED";
      winner: string;
      reason: "last-standing" | "opponents-forfeited" | "round-limit" | "final-tie";
    }
);

export interface TurnTimerView {
  /** Whose turn the timer is for (the round leader). */
  playerId: string;
  /** Epoch ms when the server will auto-play. */
  deadline: number;
}

export interface ChatMessageView {
  from: { id: string; name: string };
  text: string;
  at: number;
}

export interface ChatReactionView {
  from: { id: string; name: string };
  emote: (typeof EMOTES)[number];
  at: number;
}

// ---------------------------------------------------------------------------
// Socket.IO event maps
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  "room:state": (room: RoomView) => void;
  "room:closed": (info: { reason: "host-left" | "idle" | "server-shutdown" }) => void;
  "game:events": (events: RedactedGameEvent[]) => void;
  "game:timer": (timer: TurnTimerView | null) => void;
  "chat:message": (message: ChatMessageView) => void;
  "chat:reaction": (reaction: ChatReactionView) => void;
}

export interface ClientToServerEvents {
  "room:create": (
    payload: z.input<typeof createRoomSchema>,
    ack: (reply: Ack<RoomJoined>) => void,
  ) => void;
  "room:join": (
    payload: z.input<typeof joinRoomSchema>,
    ack: (reply: Ack<RoomJoined>) => void,
  ) => void;
  "room:resume": (
    payload: z.input<typeof resumeRoomSchema>,
    ack: (reply: Ack<RoomResumed>) => void,
  ) => void;
  "room:leave": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
  "room:ready": (payload: z.input<typeof setReadySchema>, ack: (reply: Ack<null>) => void) => void;
  "room:settings": (
    payload: z.input<typeof roomSettingsPatchSchema>,
    ack: (reply: Ack<null>) => void,
  ) => void;
  "room:start": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
  "room:rematch": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
  "game:selectStat": (
    payload: z.input<typeof selectStatSchema>,
    ack: (reply: Ack<null>) => void,
  ) => void;
  "game:forfeit": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
  "chat:send": (payload: z.input<typeof chatSendSchema>, ack: (reply: Ack<null>) => void) => void;
  "chat:react": (payload: z.input<typeof chatReactSchema>, ack: (reply: Ack<null>) => void) => void;
}
