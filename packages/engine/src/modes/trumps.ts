/**
 * Classic and Power Trumps as `GameMode` plugins. Both are variants of the
 * one trumps state machine (`../apply.ts`, `../reducer.ts`); this file only
 * adapts it to the plugin contract and owns the redaction rules that used to
 * live in the server — what a viewer may see is a rule of the game, so it
 * belongs with the game.
 */
import type { PowerPlayView, TrumpsEventView } from "@deckxi/shared";
import { applyCommand } from "../apply.js";
import { baselineBot } from "../bot.js";
import { reduce } from "../reducer.js";
import { initGame } from "../setup.js";
import {
  CommandRejectedError,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerId,
  type TrumpsVariant,
} from "../types.js";
import type { GameMode, ModeInspection, ModeSetup, ModeStatus } from "../mode.js";

export type TrumpsMode = GameMode<GameState, Command, GameEvent, TrumpsEventView>;

/** Who the table is waiting on: the leader while they call, every unanswered seat while it responds. */
export function trumpsWaitingOn(state: GameState): PlayerId[] {
  if (state.phase === "finished") return [];
  if (state.phase === "responding") {
    const played = state.pending?.plays ?? {};
    return state.players.filter((p) => p.active && !(p.id in played)).map((p) => p.id);
  }
  return [state.leader];
}

function isPowerPlay(value: unknown): value is PowerPlayView {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "powerplay" || kind === "super-over") return true;
  return kind === "drs" && typeof (value as { stat?: unknown }).stat === "string";
}

/**
 * Redact one trumps event for a viewer (`null` = spectator). Reveals are
 * public by construction — they only ever contain cards that just left a
 * hand — but a committed card stays hidden until then, and a DRS stat is
 * the reviewer's secret until the reveal.
 */
export function redactTrumpsEvent(
  event: GameEvent,
  viewerId: PlayerId | null,
  editionId: string,
): TrumpsEventView {
  if (event.type === "STAT_SELECTED") {
    if (event.cardId === undefined) return event;
    const mine = viewerId === event.playerId;
    return {
      type: "STAT_SELECTED",
      playerId: event.playerId,
      stat: event.stat,
      auto: event.auto,
      cardId: mine ? event.cardId : null,
      power: event.power ?? null,
    };
  }
  if (event.type === "CARD_PLAYED") {
    const mine = viewerId === event.playerId;
    const power =
      event.power?.kind === "drs" && !mine ? ({ kind: "drs" } as const) : (event.power ?? null);
    return {
      type: "CARD_PLAYED",
      playerId: event.playerId,
      cardId: mine ? event.cardId : null,
      power,
      auto: event.auto,
    };
  }
  if (event.type !== "GAME_STARTED") return event;

  const handCounts: Record<string, number> = {};
  for (const [playerId, hand] of Object.entries(event.hands)) handCounts[playerId] = hand.length;
  const { config } = event;
  return {
    type: "GAME_STARTED",
    config: {
      mode: config.mode ?? "classic-trumps",
      players: [...config.players],
      cards: config.cards.map((c) => ({ id: c.id, stats: { ...c.stats } })),
      stats: config.stats.map((s) => ({
        key: s.key,
        direction: s.direction,
        min: s.min,
        max: s.max,
      })),
      maxRounds: config.maxRounds,
      editionId,
    },
    firstLeader: event.firstLeader,
    yourHand: viewerId !== null && event.hands[viewerId] ? [...event.hands[viewerId]] : null,
    handCounts,
  };
}

function trumpsMode(variant: TrumpsVariant): TrumpsMode {
  return {
    id: variant,
    players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
    deckSize: (cardsPerPlayer, playerCount) => cardsPerPlayer * playerCount,
    init: (setup: ModeSetup) =>
      initGame({
        players: setup.players,
        cards: setup.cards,
        stats: setup.stats,
        seed: setup.seed,
        ...(setup.maxRounds !== undefined ? { maxRounds: setup.maxRounds } : {}),
        mode: variant,
      }),
    reduce,
    apply: applyCommand,
    status(state): ModeStatus {
      const ended = state.phase === "finished";
      return {
        phase: state.phase,
        finished: ended,
        winner: state.winner,
        round: state.round,
        waitingOn: trumpsWaitingOn(state),
        turnKey: `${state.round}:${state.phase}`,
        active: state.players.filter((p) => p.active).map((p) => p.id),
      };
    },
    clientCommand(playerId, payload): Command {
      const p = payload as {
        type?: unknown;
        stat?: unknown;
        cardIndex?: unknown;
        power?: unknown;
      };
      const cardIndex = typeof p.cardIndex === "number" ? { cardIndex: p.cardIndex } : {};
      const power =
        p.power === null ? { power: null } : isPowerPlay(p.power) ? { power: p.power } : {};
      if (p.type === "SELECT_STAT" && typeof p.stat === "string") {
        return { type: "SELECT_STAT", playerId, stat: p.stat, ...cardIndex, ...power };
      }
      if (p.type === "PLAY_CARD" && typeof p.cardIndex === "number") {
        return { type: "PLAY_CARD", playerId, cardIndex: p.cardIndex, ...power };
      }
      throw new CommandRejectedError("unknown-command", String(p.type));
    },
    autoPlay: (playerId) => ({ type: "AUTO_PLAY", playerId }),
    forfeit: (playerId) => ({ type: "FORFEIT", playerId }),
    redact: redactTrumpsEvent,
    bot: baselineBot,
    inspect(state): ModeInspection {
      return {
        phase: state.phase,
        round: state.round,
        leader: state.leader,
        winner: state.winner,
        players: state.players.map((p) => ({ id: p.id, active: p.active, cards: [...p.hand] })),
        loose: [...state.pot],
        detail: {
          lastStat: state.lastStat,
          pending: state.pending,
          powers: Object.fromEntries(state.players.map((p) => [p.id, p.powers])),
        },
      };
    },
  };
}

export const classicTrumps: TrumpsMode = trumpsMode("classic-trumps");
export const powerTrumps: TrumpsMode = trumpsMode("power-trumps");
