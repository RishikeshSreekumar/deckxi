/**
 * What the shipped edition is made of. Teams are nations — country names
 * are nobody's trademark, unlike franchise names, crests and colours — so a
 * card carries the player's national side and nothing else.
 *
 * Colours are the frame colour for the card design system: one recognisable
 * hue per nation, chosen to read on cream stock. They are not board logos.
 */
import type { Team } from "@deckxi/shared";
import type { SelectionConfig, SquadShape } from "./select.js";

export const T20I_TEAMS: Team[] = [
  { id: "india", name: "India", shortName: "IND", color: "#1d5fd1" },
  { id: "australia", name: "Australia", shortName: "AUS", color: "#c9a227" },
  { id: "england", name: "England", shortName: "ENG", color: "#0b3d91" },
  { id: "new-zealand", name: "New Zealand", shortName: "NZ", color: "#1b1b1b" },
  { id: "pakistan", name: "Pakistan", shortName: "PAK", color: "#0f6b3a" },
  { id: "south-africa", name: "South Africa", shortName: "SA", color: "#0f7a4a" },
  { id: "sri-lanka", name: "Sri Lanka", shortName: "SL", color: "#1a4aa3" },
  { id: "bangladesh", name: "Bangladesh", shortName: "BAN", color: "#0c5a3a" },
  { id: "west-indies", name: "West Indies", shortName: "WI", color: "#7a1c3a" },
  { id: "ireland", name: "Ireland", shortName: "IRE", color: "#0f8a4a" },
  { id: "zimbabwe", name: "Zimbabwe", shortName: "ZIM", color: "#b3121a" },
  { id: "netherlands", name: "Netherlands", shortName: "NED", color: "#e05a1a" },
  { id: "scotland", name: "Scotland", shortName: "SCO", color: "#2a2f6b" },
  { id: "nepal", name: "Nepal", shortName: "NEP", color: "#c8102e" },
];

/** Fifteen cards a full member: five batters, two keepers, three all-rounders, five bowlers. */
export const T20I_SQUAD: SquadShape = { batter: 5, keeper: 2, "all-rounder": 3, bowler: 5 };

/**
 * Ten cards an associate, and only from players with a real body of T20I work.
 * Zimbabwe, Ireland, the Netherlands, Scotland and Nepal play a fraction of
 * the calendar the full members do, so an equal share hands fifteen cards to
 * nations whose best player has fewer caps than a full member's twelfth man.
 * The deck should lean on the sides people know.
 */
export const T20I_ASSOCIATES = ["ireland", "zimbabwe", "netherlands", "scotland", "nepal"];
export const T20I_ASSOCIATE_SQUAD: SquadShape = {
  batter: 3,
  keeper: 1,
  "all-rounder": 2,
  bowler: 4,
};

export const T20I_SELECTION: Omit<SelectionConfig, "roleOverrides"> = {
  teams: T20I_TEAMS,
  minMatches: 20,
  squad: T20I_SQUAD,
  associates: {
    teams: T20I_ASSOCIATES,
    minMatches: 40,
    squad: T20I_ASSOCIATE_SQUAD,
  },
  // Roughly the seed edition's proportions (1 in 8 legends, 1 in 4 stars).
  tiers: { legend: 0.125, star: 0.25 },
};

/**
 * The eight card stats, in the order the card prints them: four with the
 * bat, four with the ball. Bounds are refitted to the deck on every import.
 */
export const T20I_STATS = [
  { key: "battingAvg", blurb: "Runs scored per time out, with the bat.", name: "Batting average", group: "bat", short: "Avg.", direction: "higher", format: "decimal" }, // prettier-ignore
  { key: "strikeRate", blurb: "Runs scored per 100 balls faced — how fast they score.", name: "Strike rate", group: "bat", short: "S/R", direction: "higher", format: "decimal" }, // prettier-ignore
  { key: "runs", blurb: "Career runs in T20 internationals.", name: "T20I runs", group: "bat", short: "Runs", direction: "higher", format: "integer" }, // prettier-ignore
  { key: "highest", blurb: "Their best single-innings score.", name: "Highest score", group: "bat", short: "H/S", direction: "higher", format: "integer" }, // prettier-ignore
  { key: "wickets", blurb: "Career wickets in T20 internationals.", name: "T20I wickets", group: "ball", short: "Wkt.", direction: "higher", format: "integer" }, // prettier-ignore
  { key: "economy", blurb: "Runs given away per over bowled. Fewer is better.", name: "Economy", group: "ball", short: "Econ.", direction: "lower", format: "decimal" }, // prettier-ignore
  { key: "catches", blurb: "Career catches in the field.", name: "Catches", group: "ball", short: "Ct.", direction: "higher", format: "integer" }, // prettier-ignore
  { key: "bestBowling", blurb: "Best figures in one match, as wickets/runs (4/16 = four wickets for 16 runs).", name: "Best bowling", group: "ball", short: "Best", direction: "higher", format: "figures" }, // prettier-ignore
] as const;

/** The card's two columns: the bat on the left, the ball on the right. */
export const T20I_STAT_GROUPS = [
  { id: "bat", name: "Batting", icon: "batter" },
  { id: "ball", name: "Bowling", icon: "bowler" },
];
