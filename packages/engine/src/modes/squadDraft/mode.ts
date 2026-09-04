/**
 * Squad Draft as a `GameMode` plugin, including what a viewer may see.
 *
 * Almost everything in a draft is public — the pool is face up, every pick
 * is announced — so redaction only touches one thing: a submitted XI stays
 * its owner's secret until every XI is in and the matches are played.
 */
import type { SquadDraftEventView } from "@deckxi/shared";
import { CommandRejectedError, type PlayerId } from "../../types.js";
import type { GameMode, ModeInspection, ModeSetup, ModeStatus } from "../../mode.js";
import { applySquadDraft } from "./apply.js";
import { squadDraftBot } from "./bot.js";
import { nextPickIndex, onTheClock, reduceSquadDraft } from "./reducer.js";
import { initSquadDraft, squadDraftPoolSize } from "./setup.js";
import {
  MAX_SQUAD_PLAYERS,
  MIN_SQUAD_PLAYERS,
  SQUAD_DRAFT_MODE,
  type Roster,
  type SquadDraftCommand,
  type SquadDraftEvent,
  type SquadDraftState,
} from "./types.js";

export type SquadDraftMode = GameMode<
  SquadDraftState,
  SquadDraftCommand,
  SquadDraftEvent,
  SquadDraftEventView
>;

/** Everyone the table waits on: the picker while drafting, every unsubmitted side while building. */
export function squadDraftWaitingOn(state: SquadDraftState): PlayerId[] {
  if (state.phase === "drafting") {
    const picker = onTheClock(state);
    return picker === null ? [] : [picker];
  }
  if (state.phase === "building") {
    return state.config.players.filter((id) => state.active[id] && state.rosters[id] == null);
  }
  return [];
}

function isRoster(value: unknown): value is Roster {
  if (typeof value !== "object" || value === null) return false;
  const r = value as { order?: unknown; bowlers?: unknown; keeper?: unknown };
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  return strings(r.order) && strings(r.bowlers) && typeof r.keeper === "string";
}

export function redactSquadDraftEvent(
  event: SquadDraftEvent,
  viewerId: PlayerId | null,
  editionId: string,
): SquadDraftEventView {
  if (event.type === "GAME_STARTED") {
    const { config } = event;
    return {
      type: "GAME_STARTED",
      config: {
        mode: SQUAD_DRAFT_MODE,
        players: [...config.players],
        cards: config.cards.map((c) => ({
          id: c.id,
          stats: { ...c.stats },
          ...(c.role !== undefined ? { role: c.role } : {}),
          ...(c.nation !== undefined ? { nation: c.nation } : {}),
        })),
        stats: config.stats.map((s) => ({
          key: s.key,
          direction: s.direction,
          min: s.min,
          max: s.max,
        })),
        editionId,
        squadSize: config.squadSize,
        xiSize: config.xiSize,
        bowlerCount: config.bowlerCount,
        nationCap: config.nationCap,
        facets: {
          batting: [...config.facets.batting],
          bowling: [...config.facets.bowling],
          fielding: [...config.facets.fielding],
        },
      },
      pool: [...event.pool],
      pickOrder: [...event.pickOrder],
    };
  }
  if (event.type === "XI_SUBMITTED") {
    return {
      type: "XI_SUBMITTED",
      playerId: event.playerId,
      roster: viewerId === event.playerId ? event.roster : null,
      auto: event.auto,
    };
  }
  return event;
}

export const squadDraft: SquadDraftMode = {
  id: SQUAD_DRAFT_MODE,
  players: { min: MIN_SQUAD_PLAYERS, max: MAX_SQUAD_PLAYERS },
  // The room's "cards per player" is a trumps setting; a draft's pool is
  // sized by its squads.
  deckSize: (_cardsPerPlayer, playerCount) => squadDraftPoolSize(playerCount),
  init: (setup: ModeSetup) =>
    initSquadDraft({
      players: setup.players,
      cards: setup.cards,
      stats: setup.stats,
      seed: setup.seed,
    }),
  reduce: reduceSquadDraft,
  apply: applySquadDraft,
  status(state): ModeStatus {
    const pick = nextPickIndex(state);
    const round =
      state.phase === "drafting"
        ? (pick ?? state.pickOrder.length) + 1
        : state.pickOrder.length + (state.phase === "building" ? 1 : 2);
    return {
      phase: state.phase,
      finished: state.phase === "finished",
      winner: state.winner,
      round,
      waitingOn: squadDraftWaitingOn(state),
      turnKey: state.phase === "drafting" ? `draft:${pick ?? "done"}` : state.phase,
      active: state.config.players.filter((id) => state.active[id]),
    };
  },
  clientCommand(playerId, payload): SquadDraftCommand {
    const p = payload as { type?: unknown; cardId?: unknown; roster?: unknown };
    if (p.type === "DRAFT_PICK" && typeof p.cardId === "string") {
      return { type: "DRAFT_PICK", playerId, cardId: p.cardId };
    }
    if (p.type === "SUBMIT_XI" && isRoster(p.roster)) {
      return { type: "SUBMIT_XI", playerId, roster: p.roster };
    }
    throw new CommandRejectedError("unknown-command", String(p.type));
  },
  autoPlay: (playerId) => ({ type: "AUTO_PLAY", playerId }),
  forfeit: (playerId) => ({ type: "FORFEIT", playerId }),
  redact: redactSquadDraftEvent,
  bot: squadDraftBot,
  inspect(state): ModeInspection {
    return {
      phase: state.phase,
      round: this.status(state).round,
      leader: onTheClock(state),
      winner: state.winner,
      players: state.config.players.map((id) => ({
        id,
        active: state.active[id] ?? false,
        cards: [...(state.squads[id] ?? [])],
      })),
      loose: [...state.pool],
      detail: {
        pickIndex: state.pickIndex,
        rosters: state.rosters,
        table: state.league?.table ?? null,
      },
    };
  },
};
