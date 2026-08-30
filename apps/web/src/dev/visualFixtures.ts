/**
 * Deterministic screen states for visual regression (#106).
 *
 * The lobby, table and results screens had no visual coverage at all, which
 * is exactly where a redesign changes the most. Standing a server up per
 * screenshot would make the suite slow and flaky, so instead we seed the
 * store directly: these are the same components the game renders, driven by
 * fixed state instead of a socket.
 *
 * Everything here is deliberately literal — no randomness, no clock, no
 * network. Card ids come from the bundled edition in seat order, so a change
 * to the edition surfaces as an intentional baseline diff rather than noise.
 *
 * Only reachable when the bundle is built with VITE_VISUAL=1; a normal
 * production build never imports this module.
 */
import type { ChatMessageView, RedactedGameConfig, RoomView } from "@deckxi/shared";
import { DEFAULT_EDITION_ID, getEdition } from "@deckxi/ui";
import type { ClientGameState, ResolvedRound } from "../game/clientGame.js";
import { useStore } from "../store/store.js";
import { revealTiming } from "../screens/GameTable.js";

const SELF = "p-self";
const SEATS = [
  { id: SELF, name: "You" },
  { id: "p-asha", name: "Asha" },
  { id: "p-dev", name: "Dev" },
  { id: "p-nour", name: "Nour" },
];

const edition = getEdition(DEFAULT_EDITION_ID);

/** Cards in edition order, so a fixture never depends on shuffle behaviour. */
function cards(count: number, offset = 0): string[] {
  const players = edition?.players ?? [];
  return Array.from({ length: count }, (_, i) => players[(offset + i) % players.length]?.id ?? "");
}

const config: RedactedGameConfig = {
  players: SEATS.map((s) => s.id),
  cards: (edition?.players ?? []).map((p) => ({ id: p.id, stats: p.stats })),
  stats: (edition?.stats ?? []).map((s) => ({
    key: s.key,
    direction: s.direction,
    min: s.min,
    max: s.max,
  })),
  maxRounds: 25,
  editionId: DEFAULT_EDITION_ID,
};

function room(phase: RoomView["phase"]): RoomView {
  return {
    roomId: "room-visual",
    code: "TRUMP7",
    phase,
    hostId: SELF,
    settings: {
      gameMode: "classic-trumps",
      editionId: DEFAULT_EDITION_ID,
      cardsPerPlayer: 7,
      turnTimerSeconds: 20,
      maxRounds: 25,
    },
    // One player deliberately away, so the "away" tag is covered too.
    players: SEATS.map((seat, i) => ({
      id: seat.id,
      name: seat.name,
      seat: i,
      ready: true,
      connected: seat.id !== "p-nour",
    })),
    spectators: [],
  };
}

function game(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    config,
    round: 4,
    leader: SELF,
    yourHand: cards(6),
    handCounts: { [SELF]: 6, "p-asha": 9, "p-dev": 7, "p-nour": 6 },
    pot: cards(2, 20),
    active: { [SELF]: true, "p-asha": true, "p-dev": true, "p-nour": true },
    selected: null,
    lastResolved: null,
    finished: false,
    winner: null,
    endReason: null,
    seq: 12,
    ...overrides,
  };
}

const chat: ChatMessageView[] = [
  { from: { id: "p-asha", name: "Asha" }, text: "who's picking first?", at: 0 },
  { from: { id: "p-dev", name: "Dev" }, text: "you are, obviously", at: 1 },
];

const resolvedRound: ResolvedRound = {
  seq: 13,
  round: 4,
  stat: edition?.stats[0]?.key ?? "",
  revealed: SEATS.map((seat, i) => ({
    playerId: seat.id,
    cardId: cards(4, 8)[i] ?? "",
    value: [62, 88, 41, 77][i] ?? 0,
  })),
  result: { kind: "won", winner: "p-asha" },
  potTaken: 2,
};

type StoreState = Partial<ReturnType<typeof useStore.getState>>;

/**
 * One entry per screenshot target. The matching tests live in
 * e2e-visual/screens.spec.ts; keeping the two apart means a baseline refresh
 * can never quietly change what is being photographed.
 */
const SCENARIOS: Record<string, () => StoreState> = {
  /** Lobby mid-gather: one player away, host with the start button live. */
  lobby: () => ({
    connection: "online",
    selfId: SELF,
    spectator: false,
    room: room("lobby"),
    game: null,
    chat,
  }),

  /** Table waiting on your pick — the highest-stakes idle state. */
  "table-turn": () => ({
    connection: "online",
    selfId: SELF,
    spectator: false,
    room: room("playing"),
    game: game(),
    timer: null,
    pendingReveals: [],
  }),

  /**
   * Table mid-reveal with the verdict up. The presenter normally clears the
   * reveal after a couple of seconds, which would race the screenshot, so
   * this holds the verdict open — see revealTiming.
   */
  "table-reveal": () => {
    revealTiming.flipMs = 0;
    revealTiming.verdictMs = 600_000;
    return {
      connection: "online",
      selfId: SELF,
      spectator: false,
      room: room("playing"),
      game: game({ leader: "p-asha" }),
      timer: null,
      pendingReveals: [resolvedRound],
    };
  },

  /** Results with you winning — the panel's loudest state. */
  results: () => ({
    connection: "online",
    selfId: SELF,
    spectator: false,
    room: room("results"),
    game: game({
      round: 19,
      finished: true,
      winner: SELF,
      endReason: "last-standing",
      handCounts: { [SELF]: 28, "p-asha": 0, "p-dev": 0, "p-nour": 0 },
      active: { [SELF]: true, "p-asha": false, "p-dev": false, "p-nour": false },
      yourHand: cards(28),
      pot: [],
    }),
    pendingReveals: [],
    presenting: false,
  }),
};

/**
 * If the URL names a scenario, seed the store and rewrite the path so the
 * app's own routing takes over from there. Returns whether it took over — the
 * caller then skips session and socket setup, so no screenshot can catch a
 * connection banner mid-frame.
 */
export function applyVisualFixture(): boolean {
  const match = /^\/__visual\/([\w-]+)$/.exec(location.pathname);
  const scenario = match === null ? undefined : SCENARIOS[match[1] ?? ""];
  if (scenario === undefined) return false;
  useStore.setState(scenario());
  history.replaceState(null, "", "/");
  return true;
}
