/**
 * The app store: a Zustand slice fed by socket events. Components read state;
 * user intent goes through the action methods, which send commands and apply
 * optimistic updates that roll back if the server rejects them.
 */
import { create } from "zustand";
import type {
  ChatMessageView,
  ChatReactionView,
  RedactedGameEvent,
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
import { call, errorMessage, getSocket } from "../lib/socket.js";
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
  /** Set when the room we were in closed under us; shown on the landing page. */
  roomClosedReason: "host-left" | "idle" | "server-shutdown" | null;
  selfId: string | null;
  spectator: boolean;
  room: RoomView | null;
  game: ClientGameState | null;
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
  createRoom(name: string): Promise<void>;
  joinRoom(code: string, name: string, spectator?: boolean): Promise<void>;
  leaveRoom(): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  updateSettings(patch: Partial<RoomSettings>): Promise<void>;
  startGame(): Promise<void>;
  rematch(): Promise<void>;
  selectStat(stat: string): Promise<void>;
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
    timer: null,
    pendingReveals: [],
    pendingStat: null,
    chat: [],
    reactions: [],
    roomClosedReason: null,
  });
}

type SetState = (partial: Partial<AppState>) => void;

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
    roomClosedReason: null,
    selfId: null,
    spectator: false,
    room: null,
    game: null,
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

    async createRoom(name) {
      await guarded(async () => {
        savePlayerName(name);
        const data = await call<"room:create", RoomJoined>("room:create", { name });
        joined(set, data);
      });
    },

    async joinRoom(code, name, spectator) {
      await guarded(async () => {
        savePlayerName(name);
        const data = await call<"room:join", RoomJoined>("room:join", {
          code,
          name,
          ...(spectator !== undefined ? { spectator } : {}),
        });
        joined(set, data);
      });
    },

    async leaveRoom() {
      clearSession();
      set({ room: null, game: null, timer: null, selfId: null, pendingReveals: [] });
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
      await guarded(() => call<"room:rematch", null>("room:rematch", undefined));
    },

    async selectStat(stat) {
      const previous = get().pendingStat;
      set({ pendingStat: stat }); // optimistic: highlight immediately
      try {
        await call<"game:selectStat", null>("game:selectStat", { stat });
      } catch (error) {
        set({ pendingStat: previous }); // rollback
        get().toast(errorMessage(error), "error");
      }
    },

    async forfeit() {
      await guarded(() => call<"game:forfeit", null>("game:forfeit", undefined));
    },

    async sendChat(text) {
      await guarded(() => call<"chat:send", null>("chat:send", { text }));
    },

    async react(emote) {
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
          const game = applyRedactedEvents(null, data.events, data.spectator ? null : data.selfId);
          set({ game, timer: data.timer });
        } catch {
          clearSession();
          if (get().room !== null || wasReconnecting) {
            set({ room: null, game: null, timer: null, selfId: null });
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
      set({ game: null, timer: null, pendingReveals: [], pendingStat: null });
    }
  });

  socket.on("room:closed", ({ reason }) => {
    clearSession();
    set({
      room: null,
      game: null,
      timer: null,
      selfId: null,
      pendingReveals: [],
      roomClosedReason: reason,
    });
  });

  socket.on("game:events", (events: RedactedGameEvent[]) => {
    const state = get();
    const selfId = state.spectator ? null : state.selfId;
    // Fold one event at a time so each resolved round's snapshot (with its
    // pot share) can be queued for the presenter.
    let game = state.game;
    const reveals = [...state.pendingReveals];
    let resolvedAny = false;
    for (const event of events) {
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
  });

  socket.on("game:timer", (timer: TurnTimerView | null) => {
    set({ timer });
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
