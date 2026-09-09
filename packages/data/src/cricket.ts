/**
 * The cricket edition's vocabulary (#143). Roles are per-edition data, not a
 * schema enum, so the words "batter" and "keeper" live here — in the sport's
 * own ingest path — rather than in `@deckxi/shared`, where a second sport
 * would have to either fork the app or lie about what its cards do.
 */
import type { EditionDeck, RoleDefinition } from "@deckxi/shared";

export const CRICKET_ROLE_IDS = ["batter", "bowler", "all-rounder", "keeper"] as const;
export type CricketRole = (typeof CRICKET_ROLE_IDS)[number];

/** The `roles` block every cricket edition declares. */
export const CRICKET_ROLES: RoleDefinition[] = [
  { id: "batter", name: "Batter", shortName: "BAT" },
  { id: "bowler", name: "Bowler", shortName: "BWL" },
  { id: "all-rounder", name: "All-rounder", shortName: "AR" },
  { id: "keeper", name: "Wicketkeeper", shortName: "WK" },
];

/** The sport a cricket edition declares, and the modes it can be played in. */
export const CRICKET_SPORT = "cricket";
export const CRICKET_MODES = ["classic-trumps", "power-trumps", "squad-draft"];

/** The decks a cricket edition ships with; operators add more at runtime. */
export const CRICKET_DECKS: EditionDeck[] = [
  {
    id: "all-stars",
    name: "All Stars",
    blurb: "The whole edition. Every role, every rarity.",
    sort: 0,
  },
  {
    id: "legends",
    name: "Legends",
    blurb: "Star and legend cards only. Big numbers everywhere — a close game.",
    rarities: ["star", "legend"],
    sort: 1,
  },
  {
    id: "batters-xi",
    name: "Batters' XI",
    blurb: "Batters and keepers. Averages, strike rates and runs decide.",
    roles: ["batter", "keeper"],
    sort: 2,
  },
  {
    id: "bowlers-union",
    name: "Bowlers' Union",
    blurb: "Bowlers and all-rounders. Wickets, economy and best figures rule.",
    roles: ["bowler", "all-rounder"],
    sort: 3,
  },
];
