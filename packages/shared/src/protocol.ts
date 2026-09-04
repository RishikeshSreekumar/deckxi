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
import { draftPickSchema, submitXiSchema, type SquadDraftWireEvent } from "./squadDraft.js";

/** Bumped on any breaking change; the handshake rejects mismatched clients. */
export const PROTOCOL_VERSION = 2;

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

export const GAME_MODES = ["classic-trumps", "power-trumps", "squad-draft"] as const;
export type GameModeId = (typeof GAME_MODES)[number];

/**
 * Copy for the lobby's mode picker and the table's rules sheet, plus the seat
 * limits the lobby shows before the server enforces them. The engine's mode
 * registry is the authority on limits; these must agree with it (checked in
 * the engine's registry test).
 */
export const GAME_MODE_INFO: Record<
  GameModeId,
  { name: string; blurb: string; players: { min: number; max: number }; family: "trumps" | "squad" }
> = {
  "classic-trumps": {
    name: "Classic trumps",
    blurb: "Call a stat from your top card. Best number takes the cards. Winner calls next.",
    players: { min: 2, max: 6 },
    family: "trumps",
  },
  "power-trumps": {
    name: "Power trumps",
    blurb:
      "Pick one of your top three cards. The call rotates round the table and can't repeat. Three one-shot powers: win big, or lose one extra card.",
    players: { min: 2, max: 6 },
    family: "trumps",
  },
  "squad-draft": {
    name: "Squad draft",
    blurb:
      "Snake-draft a squad of 13 from a shared pool, name your XI, then every side plays every other across three phases. Most points wins.",
    players: { min: 2, max: 4 },
    family: "squad",
  },
};

/**
 * The three power cards, in the words they are printed with. `blurb` is the
 * one-line version for a chip's tooltip; `when`/`win`/`fail` are the three
 * lines the power card itself prints, because a card a player can read is
 * worth more than a rule they have to be told.
 */
export const POWER_INFO: Record<
  PowerKindView,
  { name: string; short: string; blurb: string; when: string; win: string; fail: string }
> = {
  powerplay: {
    name: "Powerplay",
    short: "PP",
    blurb: "Win and take one extra card from every loser. Lose and give one extra.",
    when: "Play it with your card, on your call or your answer.",
    win: "Take one extra card from every player you beat.",
    fail: "Give one extra card away.",
  },
  drs: {
    name: "DRS",
    short: "DRS",
    blurb:
      "Overrule the call with a stat of your own. Win and you lead next. Lose one extra if not.",
    when: "Only when answering someone else's call — tap the stat you overrule with.",
    win: "Your stat decides the round, and you call next.",
    fail: "Give one extra card away.",
  },
  "super-over": {
    name: "Super Over",
    short: "SO",
    blurb:
      "If you lose, play your next card against the winner's for the lot. Lose that card too if it fails.",
    when: "Play it with your card. It only wakes up if you lose the round.",
    win: "Beat the winner head-to-head and take every card on the table.",
    fail: "That card is gone too.",
  },
};

export const roomSettingsSchema = z.object({
  gameMode: z.enum(GAME_MODES),
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

/** A solved CAPTCHA, sent only after the server asked for one (#87). */
const captchaTokenSchema = z.string().min(1).max(2048).optional();

export const createRoomSchema = z.object({
  name: playerNameSchema,
  settings: roomSettingsPatchSchema.optional(),
  captchaToken: captchaTokenSchema,
});

export const joinRoomSchema = z.object({
  code: joinCodeSchema,
  name: playerNameSchema,
  /** Join read-only; also forced when the room is full or in-game. */
  spectator: z.boolean().optional(),
  captchaToken: captchaTokenSchema,
});

export const resumeRoomSchema = z.object({
  roomId: z.string().min(1).max(64),
  resumeToken: z.string().min(1).max(128),
});

export const setReadySchema = z.object({ ready: z.boolean() });

/**
 * Quick match (#81): join the queue for one mode. The name travels with the
 * request because a queued player has no room yet to be seated in.
 */
export const queueJoinSchema = z.object({
  gameMode: z.enum(GAME_MODES),
  name: playerNameSchema,
});

const statKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);

export const powerPlaySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("powerplay") }),
  z.object({ kind: z.literal("super-over") }),
  z.object({ kind: z.literal("drs"), stat: statKeySchema }),
]);
export type PowerPlayView = z.infer<typeof powerPlaySchema>;

export const selectStatSchema = z.object({
  stat: statKeySchema,
  /** Power trumps: which of the top three to play (default 0). */
  cardIndex: z.number().int().min(0).max(2).optional(),
  power: powerPlaySchema.nullable().optional(),
});

/** Power trumps: a non-leader answering the call. */
export const playCardSchema = z.object({
  cardIndex: z.number().int().min(0).max(2),
  power: powerPlaySchema.nullable().optional(),
});

/**
 * One message for every mode's moves. The union is the sum of the modes'
 * client commands; the server validates here and the mode decides whether
 * the command is one it speaks (`unknown-command` otherwise).
 */
export const gameCommandSchema = z.discriminatedUnion("type", [
  selectStatSchema.extend({ type: z.literal("SELECT_STAT") }),
  playCardSchema.extend({ type: z.literal("PLAY_CARD") }),
  draftPickSchema,
  submitXiSchema,
]);
export type GameCommandPayload = z.infer<typeof gameCommandSchema>;

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
  "queue:join": queueJoinSchema,
  "queue:leave": emptySchema,
  "room:settings": roomSettingsPatchSchema,
  "room:start": emptySchema,
  "room:rematch": emptySchema,
  "game:selectStat": selectStatSchema,
  "game:playCard": playCardSchema,
  "game:forfeit": emptySchema,
  "game:command": gameCommandSchema,
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
  /** More seats filled than the chosen mode supports. */
  "too-many-players",
  "players-not-ready",
  "game-not-running",
  "command-rejected",
  "rate-limited",
  "spectators-cannot",
  "resume-failed",
  "server-full",
  /** Over an abuse quota (#87): too many rooms, joins or requests from one source. */
  "quota-exceeded",
  /**
   * The source looks like a script (join-code sweeping), and this deployment
   * has a CAPTCHA configured: retry the same message with `captchaToken`.
   */
  "captcha-required",
  /** The requested game mode is switched off by an operator (#70). */
  "mode-disabled",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Ack<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Snapshots (server → client)
// ---------------------------------------------------------------------------

export type RoomPhase = "lobby" | "playing" | "results";

/**
 * Why a client is no longer in its room. The last two are operator actions
 * (#70): "kicked" reaches one player, the rest reach everyone in the room.
 */
export type RoomClosedReason =
  "host-left" | "idle" | "server-shutdown" | "closed-by-admin" | "kicked";

export interface RoomPlayerView {
  id: string;
  name: string;
  /** A seat the server plays itself (quick-match backfill, #81). */
  bot?: boolean;
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
  events: WireGameEvent[];
  /** Current turn deadline, if a turn timer is running. */
  timer: TurnTimerView | null;
}

// ---------------------------------------------------------------------------
// Redacted game events (server → client)
// ---------------------------------------------------------------------------

export interface RedactedGameConfig {
  mode: "classic-trumps" | "power-trumps";
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

export type PowerKindView = "powerplay" | "drs" | "super-over";

export interface PowerOutcomeView {
  playerId: string;
  power: PowerKindView;
  outcome: "won" | "lost" | "void";
}

export interface CardTransferView {
  cardId: string;
  from: string | "pot";
  to: string | "pot";
}

export interface SuperOverView {
  challenger: string;
  defender: string;
  challengerCard: RevealedCardView;
  defenderCard: RevealedCardView;
  winner: string | null;
}

/** What the powers did to a power-trumps round; the client applies `transfers` verbatim. */
export interface PowerRoundView {
  calledStat: string;
  drsBy: string | null;
  outcomes: PowerOutcomeView[];
  superOvers: SuperOverView[];
  transfers: CardTransferView[];
  nextLeader: string;
}

/**
 * Trumps events with hidden information stripped per viewer. GAME_STARTED
 * carries your own hand plus card counts; the seed and other hands never
 * appear.
 */
export type TrumpsEventView =
  | {
      type: "GAME_STARTED";
      config: RedactedGameConfig;
      firstLeader: string;
      /** Your dealt hand, top card first; null for spectators. */
      yourHand: string[] | null;
      handCounts: Record<string, number>;
    }
  | {
      type: "STAT_SELECTED";
      playerId: string;
      stat: string;
      auto: boolean;
      /** Power trumps: the leader's committed card — your own only, null for others. */
      cardId?: string | null;
      /** Power trumps: the declared power. A DRS stat is yours only; others see `{ kind: "drs" }`. */
      power?: PowerPlayView | { kind: "drs" } | null;
    }
  | {
      type: "CARD_PLAYED";
      playerId: string;
      /** Your own card only; null for everyone else's. */
      cardId: string | null;
      power: PowerPlayView | { kind: "drs" } | null;
      auto: boolean;
    }
  | {
      type: "ROUND_RESOLVED";
      round: number;
      stat: string;
      revealed: RevealedCardView[];
      result: RoundResultView;
      power?: PowerRoundView;
    }
  | { type: "PLAYER_ELIMINATED"; playerId: string; round: number }
  | { type: "PLAYER_FORFEITED"; playerId: string }
  | {
      type: "GAME_ENDED";
      winner: string;
      reason: "last-standing" | "opponents-forfeited" | "round-limit" | "final-tie";
    };

/**
 * A trumps event on the wire. Every event carries the server-assigned
 * sequence number so reconnection can replay deterministically.
 */
export type RedactedGameEvent = { seq: number } & TrumpsEventView;

/**
 * Any mode's event on the wire. The room's `gameMode` says which member a
 * client should expect; GAME_STARTED's `config.mode` says the same thing.
 */
export type WireGameEvent = RedactedGameEvent | SquadDraftWireEvent;

export interface TurnTimerView {
  /** Whose turn the timer is for: the leader, or (responding) the first player still to answer. */
  playerId: string;
  /** Everyone the table is waiting on — the leader alone while they call. */
  waitingOn: string[];
  /** Epoch ms when the server will auto-play. */
  deadline: number;
}

export interface ChatMessageView {
  from: { id: string; name: string };
  text: string;
  at: number;
}

/**
 * Operator broadcast (#70): a maintenance notice shown above every screen, or
 * null to clear it. Sent on connect and whenever it changes, so a client that
 * joined mid-incident is told the same thing as one that was already here.
 */
export interface OpsNoticeView {
  text: string;
  level: "info" | "warning";
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
  "room:closed": (info: { reason: RoomClosedReason }) => void;
  "game:events": (events: WireGameEvent[]) => void;
  "game:timer": (timer: TurnTimerView | null) => void;
  "chat:message": (message: ChatMessageView) => void;
  "chat:reaction": (reaction: ChatReactionView) => void;
  "ops:notice": (notice: OpsNoticeView | null) => void;
  /**
   * Quick match found you a table (#81). Carries the same payload a
   * `room:create` ack would, because from here on it is an ordinary room.
   */
  "queue:matched": (joined: RoomJoined) => void;
  /** How the queue is going, so the waiting screen can say something true. */
  "queue:status": (status: QueueStatusView) => void;
}

/** What the player waiting in the queue is told. */
export interface QueueStatusView {
  gameMode: GameModeId;
  /** Players waiting in this mode's queue, including you. */
  waiting: number;
  /** Epoch ms after which the table is filled with bots and started. */
  botsAt: number;
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
  "queue:join": (
    payload: z.input<typeof queueJoinSchema>,
    ack: (reply: Ack<QueueStatusView>) => void,
  ) => void;
  "queue:leave": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
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
  "game:playCard": (
    payload: z.input<typeof playCardSchema>,
    ack: (reply: Ack<null>) => void,
  ) => void;
  "game:forfeit": (payload: undefined, ack: (reply: Ack<null>) => void) => void;
  "game:command": (
    payload: z.input<typeof gameCommandSchema>,
    ack: (reply: Ack<null>) => void,
  ) => void;
  "chat:send": (payload: z.input<typeof chatSendSchema>, ack: (reply: Ack<null>) => void) => void;
  "chat:react": (payload: z.input<typeof chatReactSchema>, ack: (reply: Ack<null>) => void) => void;
}
