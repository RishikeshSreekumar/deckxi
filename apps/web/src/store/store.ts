/**
 * The app store: a Zustand slice fed by socket events. Components read state;
 * user intent goes through the action methods, which send commands and apply
 * optimistic updates that roll back if the server rejects them.
 */
import { create } from "zustand";
import type {
  ChatMessageView,
  GameModeId,
  QueueStatusView,
  ChatReactionView,
  GameCommandPayload,
  PowerPlayView,
  RedactedGameEvent,
  SquadDraftWireEvent,
  WireGameEvent,
  OpsNoticeView,
  RoomClosedReason,
  RoomJoined,
  RoomResumed,
  RoomSettings,
  RoomView,
  TurnTimerView,
} from "@deckxi/shared";
import {
  applyRedactedEvents,
  type ClientGameState,
  type ResolvedRound,
} from "../game/clientGame.js";
import { applySquadEvents, type SquadClientState } from "../game/squadClient.js";
import { call, errorMessage, getSocket } from "../lib/socket.js";
import type * as PracticeModule from "../game/practice.js";
import type { PracticeOptions } from "../game/practice.js";
import { clearSession, loadSession, saveSession, savePlayerName } from "../lib/session.js";
import { sounds } from "../lib/sounds.js";

/**
 * "reconnecting" means the server is unreachable; "offline" means the device
 * says it has no network at all. They read identically to the code that
 * retries but not to the player — telling someone in a lift that we are
 * "reconnecting, hang tight" is a hopeful lie (#111).
 */
export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline";

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export interface FloatingReaction {
  id: number;
  emote: string;
  from: string;
}

interface AppState {
  connection: ConnectionStatus;
  /**
   * True while this table is a local practice game (#85). Everything the
   * server would decide is decided in `game/practice.ts` instead; the screens
   * read the same room/game slices either way.
   */
  practice: boolean;
  /** Quick match: what the queue is doing, or null when we are not in it. */
  queue: QueueStatusView | null;
  /** Set when the room we were in closed under us; shown on the landing page. */
  roomClosedReason: RoomClosedReason | null;
  /** Operator maintenance notice, shown above every screen (#70). */
  notice: OpsNoticeView | null;
  selfId: string | null;
  spectator: boolean;
  room: RoomView | null;
  /** The trumps game in this room (classic or power), folded from the wire. */
  game: ClientGameState | null;
  /** The Squad Draft in this room; which slice is live follows the room's mode. */
  squad: SquadClientState | null;
  timer: TurnTimerView | null;
  /** Rounds resolved but not yet shown — the reveal presenter drains this. */
  pendingReveals: ResolvedRound[];
  /** True while the reveal presenter is animating a round. */
  presenting: boolean;
  /** Optimistic stat pick awaiting server confirmation. */
  pendingStat: string | null;
  chat: ChatMessageView[];
  reactions: FloatingReaction[];
  toasts: Toast[];

  // -- actions ------------------------------------------------------------
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  createRoom(name: string, captchaToken?: string): Promise<void>;
  /** Join the quick-match queue for a mode (#81). */
  quickMatch(gameMode: GameModeId, name: string): Promise<void>;
  /** Leave the queue and go back to the landing page. */
  cancelQueue(): Promise<void>;
  /** Start a local game against bots — no room, no socket, works offline. */
  practiceGame(options: PracticeOptions): Promise<void>;
  joinRoom(code: string, name: string, spectator?: boolean, captchaToken?: string): Promise<void>;
  leaveRoom(): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  updateSettings(patch: Partial<RoomSettings>): Promise<void>;
  startGame(): Promise<void>;
  rematch(): Promise<void>;
  selectStat(
    stat: string,
    play?: { cardIndex: number; power: PowerPlayView | null },
  ): Promise<void>;
  /** Power trumps: answer the call with one of your top cards. */
  playCard(cardIndex: number, power: PowerPlayView | null): Promise<void>;
  /** Any mode's move (Squad Draft picks and XIs go this way). */
  command(payload: GameCommandPayload): Promise<void>;
  forfeit(): Promise<void>;
  sendChat(text: string): Promise<void>;
  react(emote: string): Promise<void>;
  shiftReveal(): void;
  setPresenting(presenting: boolean): void;
}

let nextId = 1;

function joined(set: SetState, data: RoomJoined): void {
  saveSession({ roomId: data.roomId, resumeToken: data.resumeToken });
  set({
    selfId: data.selfId,
    spectator: data.spectator,
    room: data.room,
    game: null,
    squad: null,
    timer: null,
    pendingReveals: [],
    presenting: false,
    pendingStat: null,
    chat: [],
    reactions: [],
    roomClosedReason: null,
  });
}

type SetState = (partial: Partial<AppState>) => void;

/**
 * The practice host, loaded on demand. It drags the whole engine in with it —
 * ~10 kB gzipped that a player joining a friend's table never needs, and the
 * initial payload has a budget (#107) — so nothing imports it until someone
 * asks to practise.
 */
let practiceApi: typeof PracticeModule | null = null;

/** The options the current practice table was started with, for a rematch. */
let lastPractice: PracticeOptions | null = null;

/**
 * Practice has no server to flip the room to results, so the store does what
 * the room manager would: once the engine says the game is finished, the room
 * moves on. Everything else about the results screen is unchanged.
 */
function settlePractice(set: SetState, get: () => AppState): void {
  const room = get().room;
  if (room === null || practiceApi === null || !practiceApi.practiceFinished()) return;
  if (room.phase === "results") return;
  set({ room: { ...room, phase: "results" } });
}

/** Apply one of your moves locally, then fold the bots' answers. */
function localMove(set: SetState, get: () => AppState, payload: GameCommandPayload): void {
  if (practiceApi === null || !practiceApi.practiceRunning()) return;
  try {
    ingestGameEvents(set, get, practiceApi.practiceCommand(payload));
    settlePractice(set, get);
  } catch (error) {
    // The engine rejects the same moves the server would; the toast is the
    // only difference, since there is no ack to unwrap.
    set({ pendingStat: null });
    get().toast(error instanceof Error ? error.message : "That move isn't allowed.", "error");
  }
}

export const useStore = create<AppState>((set, get) => {
  const guarded = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      get().toast(errorMessage(error), "error");
      throw error;
    }
  };

  return {
    connection: "connecting",
    practice: false,
    queue: null,
    roomClosedReason: null,
    notice: null,
    selfId: null,
    spectator: false,
    room: null,
    game: null,
    squad: null,
    timer: null,
    pendingReveals: [],
    presenting: false,
    pendingStat: null,
    chat: [],
    reactions: [],
    toasts: [],

    toast(text, kind = "info") {
      const id = nextId++;
      set({ toasts: [...get().toasts, { id, text, kind }] });
      setTimeout(() => get().dismissToast(id), 5000);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },

    async createRoom(name, captchaToken) {
      await guarded(async () => {
        savePlayerName(name);
        const data = await call<"room:create", RoomJoined>("room:create", {
          name,
          ...(captchaToken !== undefined ? { captchaToken } : {}),
        });
        joined(set, data);
      });
    },

    async quickMatch(gameMode, name) {
      await guarded(async () => {
        savePlayerName(name);
        const status = await call<"queue:join", QueueStatusView>("queue:join", { gameMode, name });
        set({ queue: status });
      });
    },

    async cancelQueue() {
      set({ queue: null });
      try {
        await call<"queue:leave", null>("queue:leave", undefined);
      } catch {
        // Already out (matched, or disconnected) — leaving is best-effort.
      }
    },

    async practiceGame(options) {
      savePlayerName(options.name);
      clearSession();
      practiceApi ??= await import("../game/practice.js");
      const table = practiceApi.startPractice(options);
      set({
        practice: true,
        selfId: table.selfId,
        spectator: false,
        room: table.room,
        game: null,
        squad: null,
        timer: null,
        pendingReveals: [],
        presenting: false,
        pendingStat: null,
        chat: [],
        reactions: [],
        roomClosedReason: null,
      });
      lastPractice = options;
      ingestGameEvents(set, get, table.events);
      settlePractice(set, get);
    },

    async joinRoom(code, name, spectator, captchaToken) {
      await guarded(async () => {
        savePlayerName(name);
        const data = await call<"room:join", RoomJoined>("room:join", {
          code,
          name,
          ...(spectator !== undefined ? { spectator } : {}),
          ...(captchaToken !== undefined ? { captchaToken } : {}),
        });
        joined(set, data);
      });
    },

    async leaveRoom() {
      if (get().practice) {
        practiceApi?.endPractice();
        set({
          practice: false,
          room: null,
          game: null,
          squad: null,
          timer: null,
          selfId: null,
          pendingReveals: [],
          presenting: false,
        });
        return;
      }
      clearSession();
      set({
        room: null,
        game: null,
        squad: null,
        timer: null,
        selfId: null,
        pendingReveals: [],
        presenting: false,
      });
      try {
        await call<"room:leave", null>("room:leave", undefined);
      } catch {
        // Already gone (disconnect, room closed) — leaving is best-effort.
      }
    },

    async setReady(ready) {
      await guarded(() => call<"room:ready", null>("room:ready", { ready }));
    },

    async updateSettings(patch) {
      await guarded(() => call<"room:settings", null>("room:settings", patch));
    },

    async startGame() {
      await guarded(() => call<"room:start", null>("room:start", undefined));
    },

    async rematch() {
      if (get().practice) {
        if (lastPractice !== null) await get().practiceGame(lastPractice);
        return;
      }
      await guarded(() => call<"room:rematch", null>("room:rematch", undefined));
    },

    async selectStat(stat, play) {
      const previous = get().pendingStat;
      set({ pendingStat: stat }); // optimistic: highlight immediately
      if (get().practice) {
        localMove(set, get, {
          type: "SELECT_STAT",
          stat,
          ...(play !== undefined ? { cardIndex: play.cardIndex, power: play.power } : {}),
        });
        return;
      }
      try {
        await call<"game:selectStat", null>("game:selectStat", {
          stat,
          ...(play !== undefined ? { cardIndex: play.cardIndex, power: play.power } : {}),
        });
      } catch (error) {
        set({ pendingStat: previous }); // rollback
        get().toast(errorMessage(error), "error");
      }
    },

    async playCard(cardIndex, power) {
      if (get().practice) {
        localMove(set, get, { type: "PLAY_CARD", cardIndex, power });
        return;
      }
      await guarded(() => call<"game:playCard", null>("game:playCard", { cardIndex, power }));
    },

    async command(payload) {
      if (get().practice) {
        localMove(set, get, payload);
        return;
      }
      await guarded(() => call<"game:command", null>("game:command", payload));
    },

    async forfeit() {
      if (get().practice && practiceApi !== null) {
        try {
          ingestGameEvents(set, get, practiceApi.practiceForfeit());
          settlePractice(set, get);
        } catch {
          /* nothing to forfeit — the game already ended */
        }
        return;
      }
      await guarded(() => call<"game:forfeit", null>("game:forfeit", undefined));
    },

    async sendChat(text) {
      if (get().practice) {
        get().toast("There's nobody to chat to in a practice game.", "info");
        return;
      }
      await guarded(() => call<"chat:send", null>("chat:send", { text }));
    },

    async react(emote) {
      if (get().practice) return;
      await guarded(() => call<"chat:react", null>("chat:react", { emote: emote as "👏" }));
    },

    shiftReveal() {
      set({ pendingReveals: get().pendingReveals.slice(1) });
    },

    setPresenting(presenting) {
      set({ presenting });
    },
  };
});

/**
 * Fold a batch of wire events into the live game slice. Shared by the socket
 * and by offline practice (#85), which produces the very same redacted events
 * locally — one folding path means the table cannot behave differently
 * depending on who hosted the game.
 */
function ingestGameEvents(set: SetState, get: () => AppState, events: WireGameEvent[]): void {
  const state = get();
  const selfId = state.spectator ? null : state.selfId;
  if (state.room?.settings.gameMode === "squad-draft") {
    const squadEvents = events as SquadDraftWireEvent[];
    const squad = applySquadEvents(state.squad, squadEvents, selfId);
    if (squad === null) return;
    if (squadEvents.some((e) => e.type === "GAME_STARTED")) sounds.deal();
    // The matches are the climax: hold the results screen back until the
    // table has shown them phase by phase.
    const played = squadEvents.some((e) => e.type === "MATCHES_PLAYED");
    set({ squad, ...(played ? { presenting: true } : {}) });
    return;
  }
  // Fold one event at a time so each resolved round's snapshot (with its
  // pot share) can be queued for the presenter.
  let game = state.game;
  const reveals = [...state.pendingReveals];
  let resolvedAny = false;
  for (const event of events as RedactedGameEvent[]) {
    game = applyRedactedEvents(game, [event], selfId);
    if (event.type === "GAME_STARTED") sounds.deal();
    if (event.type === "ROUND_RESOLVED" && game?.lastResolved != null) {
      reveals.push(game.lastResolved);
      resolvedAny = true;
    }
  }
  if (game === null) return;
  set({
    game,
    pendingReveals: reveals,
    ...(resolvedAny ? { pendingStat: null } : {}),
  });
}

// ---------------------------------------------------------------------------
// Socket wiring — registered once at app boot.
// ---------------------------------------------------------------------------

let wired = false;

export function initSocket(): void {
  if (wired) return;
  wired = true;
  const socket = getSocket();
  const { setState: set, getState: get } = useStore;

  socket.on("connect", () => {
    void (async () => {
      const wasReconnecting = get().connection === "reconnecting";
      set({ connection: "online" });
      const session = loadSession();
      // Resume after a drop (or a page reload mid-game).
      if (session !== null && (wasReconnecting || get().room === null)) {
        try {
          const data = await call<"room:resume", RoomResumed>("room:resume", session);
          joined(set, data);
          const viewer = data.spectator ? null : data.selfId;
          if (data.room.settings.gameMode === "squad-draft") {
            const squad = applySquadEvents(null, data.events as SquadDraftWireEvent[], viewer);
            // Rejoining after the matches: show the table, not the reveal.
            set({ squad, timer: data.timer });
          } else {
            const game = applyRedactedEvents(null, data.events as RedactedGameEvent[], viewer);
            set({ game, timer: data.timer });
          }
        } catch {
          clearSession();
          if (get().room !== null || wasReconnecting) {
            set({ room: null, game: null, squad: null, timer: null, selfId: null });
            get().toast("Couldn't rejoin your game — it may have ended.", "error");
          }
        }
      }
    })();
  });

  socket.on("disconnect", () => {
    set({ connection: navigator.onLine ? "reconnecting" : "offline" });
  });

  // navigator.onLine is the only signal that separates "no signal" from "the
  // server is slow". It is not authoritative about reaching *our* server, so
  // it only ever downgrades us to "offline" and hands back to the socket's own
  // state on the way up.
  window.addEventListener("offline", () => {
    set({ connection: "offline" });
  });
  window.addEventListener("online", () => {
    if (get().connection !== "offline") return;
    set({ connection: socket.connected ? "online" : "reconnecting" });
    if (!socket.connected) socket.connect();
  });
  socket.io.on("reconnect_attempt", () => {
    set({ connection: "reconnecting" });
  });
  socket.io.on("error", () => {
    if (get().connection === "connecting") {
      set({ connection: navigator.onLine ? "reconnecting" : "offline" });
    }
  });

  socket.on("room:state", (room: RoomView) => {
    const previous = get().room;
    set({ room });
    // Rematch: server flips results → lobby and clears the old game.
    if (previous?.phase === "results" && room.phase === "lobby") {
      set({ game: null, squad: null, timer: null, pendingReveals: [], pendingStat: null });
    }
  });

  socket.on("room:closed", ({ reason }) => {
    clearSession();
    set({
      room: null,
      game: null,
      squad: null,
      timer: null,
      selfId: null,
      pendingReveals: [],
      presenting: false,
      roomClosedReason: reason,
    });
  });

  socket.on("game:events", (events: WireGameEvent[]) => {
    ingestGameEvents(set, get, events);
  });

  socket.on("game:timer", (timer: TurnTimerView | null) => {
    set({ timer });
  });

  socket.on("queue:status", (status: QueueStatusView) => {
    // Only while we are actually waiting: a status arriving after we matched
    // would put the waiting screen back over a live game.
    if (get().queue !== null) set({ queue: status });
  });

  socket.on("queue:matched", (data: RoomJoined) => {
    set({ queue: null });
    joined(set, data);
  });

  socket.on("ops:notice", (notice: OpsNoticeView | null) => {
    set({ notice });
  });

  socket.on("chat:message", (message: ChatMessageView) => {
    set({ chat: [...get().chat, message].slice(-100) });
  });

  socket.on("chat:reaction", (reaction: ChatReactionView) => {
    const id = nextId++;
    set({
      reactions: [...get().reactions, { id, emote: reaction.emote, from: reaction.from.name }],
    });
    setTimeout(() => {
      useStore.setState({ reactions: useStore.getState().reactions.filter((r) => r.id !== id) });
    }, 2500);
  });
}
