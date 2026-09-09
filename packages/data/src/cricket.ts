/**
 * The cricket edition's vocabulary (#143). Roles are per-edition data, not a
 * schema enum, so the words "batter" and "keeper" live here — in the sport's
 * own ingest path — rather than in `@deckxi/shared`, where a second sport
 * would have to either fork the app or lie about what its cards do.
 */
import type { RoleDefinition } from "@deckxi/shared";

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
