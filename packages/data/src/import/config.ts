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

/** Fifteen cards a nation: five batters, two keepers, three all-rounders, five bowlers. */
export const T20I_SQUAD: SquadShape = { batter: 5, keeper: 2, "all-rounder": 3, bowler: 5 };

export const T20I_SELECTION: Omit<SelectionConfig, "roleOverrides"> = {
  teams: T20I_TEAMS,
  minMatches: 15,
  squad: T20I_SQUAD,
  // Roughly the seed edition's proportions (1 in 8 legends, 1 in 4 stars).
  tiers: { legend: 0.125, star: 0.25 },
};

/**
 * The eight card stats, in the order the card prints them: four with the
 * bat, four with the ball. Bounds are refitted to the deck on every import.
 */
export const T20I_STATS = [
  { key: "battingAvg", name: "Batting average", direction: "higher", format: "decimal" },
  { key: "strikeRate", name: "Strike rate", direction: "higher", format: "decimal" },
  { key: "runs", name: "T20I runs", direction: "higher", format: "integer" },
  { key: "highest", name: "Highest score", direction: "higher", format: "integer" },
  { key: "wickets", name: "T20I wickets", direction: "higher", format: "integer" },
  { key: "economy", name: "Economy", direction: "lower", format: "decimal" },
  { key: "catches", name: "Catches", direction: "higher", format: "integer" },
  { key: "bestBowling", name: "Best bowling", direction: "higher", format: "figures" },
] as const;
