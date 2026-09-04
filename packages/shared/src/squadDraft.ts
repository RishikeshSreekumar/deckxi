/**
 * Squad Draft on the wire — the client commands and the redacted events the
 * server pushes. The rules live in `docs/games/squad-draft.md` and the engine
 * in `@deckxi/engine` (`modes/squadDraft`); this file is only the contract
 * the web client folds.
 */
import { z } from "zod";

const cardIdSchema = z.string().min(1).max(64);

/** A submitted XI: batting order (11), who bowls (5, in bowling order), who keeps. */
export const rosterSchema = z.object({
  order: z.array(cardIdSchema).min(1).max(11),
  bowlers: z.array(cardIdSchema).min(1).max(5),
  keeper: cardIdSchema,
});
export type RosterView = z.infer<typeof rosterSchema>;

export const draftPickSchema = z.object({ type: z.literal("DRAFT_PICK"), cardId: cardIdSchema });
export const submitXiSchema = z.object({ type: z.literal("SUBMIT_XI"), roster: rosterSchema });

export const SQUAD_PHASE_KEYS = ["powerplay", "middle", "finish"] as const;
export type SquadPhaseKey = (typeof SQUAD_PHASE_KEYS)[number];

export const SQUAD_PHASE_INFO: Record<SquadPhaseKey, { name: string; blurb: string }> = {
  powerplay: {
    name: "Powerplay",
    blurb: "Your top three batters against their opening pair.",
  },
  middle: {
    name: "Middle overs",
    blurb: "Batters four to seven against their third, fourth and fifth bowlers.",
  },
  finish: {
    name: "Finish & field",
    blurb: "The tail's batting, the whole XI's catching, and whether a real keeper has the gloves.",
  },
};

export interface SquadPhaseView {
  key: SquadPhaseKey;
  /** Each side's score for the phase, one decimal. */
  home: number;
  away: number;
  /** Null on a dead heat. */
  winner: string | null;
}

export interface SquadMatchView {
  home: string;
  away: string;
  phases: SquadPhaseView[];
  /** Phases won by each side. */
  homePhases: number;
  awayPhases: number;
  /** Total home minus away across the phases, one decimal. */
  margin: number;
  result: "home" | "away" | "draw";
}

export interface SquadTableRow {
  playerId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  margin: number;
}

export interface SquadLeagueView {
  matches: SquadMatchView[];
  /** Sorted: points, then margin, then seat. The winner is row 0. */
  table: SquadTableRow[];
}

export interface SquadDraftConfigView {
  mode: "squad-draft";
  players: string[];
  cards: { id: string; stats: Record<string, number>; role?: string; nation?: string }[];
  stats: { key: string; direction: "higher" | "lower"; min: number; max: number }[];
  editionId: string;
  squadSize: number;
  xiSize: number;
  bowlerCount: number;
  nationCap: number;
  facets: { batting: string[]; bowling: string[]; fielding: string[] };
}

/** Squad Draft events as a viewer sees them. Only a submitted XI is ever hidden. */
export type SquadDraftEventView =
  | {
      type: "GAME_STARTED";
      config: SquadDraftConfigView;
      /** The pool, in the order it is laid out. */
      pool: string[];
      /** The full snake order, one entry per pick. */
      pickOrder: string[];
    }
  | { type: "CARD_DRAFTED"; playerId: string; cardId: string; pick: number; auto: boolean }
  | { type: "DRAFT_COMPLETED" }
  | {
      type: "XI_SUBMITTED";
      playerId: string;
      /** Your own roster; null for everyone else's until the matches are played. */
      roster: RosterView | null;
      auto: boolean;
    }
  | { type: "PLAYER_FORFEITED"; playerId: string }
  | {
      type: "MATCHES_PLAYED";
      rosters: Record<string, RosterView>;
      /** Each card's form multiplier this game (0.9–1.1), rolled from the seed. */
      form: Record<string, number>;
      league: SquadLeagueView;
    }
  | { type: "GAME_ENDED"; winner: string; reason: "league" | "opponents-forfeited" };

export type SquadDraftWireEvent = { seq: number } & SquadDraftEventView;
