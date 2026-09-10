/**
 * What the WWE edition is made of (#143) — the second sport, and the proof
 * that an edition is data rather than a fork.
 *
 * Its vocabulary is its own: roles are what a wrestler *is* in a match, the
 * card's two columns are the gold and the craft, and none of those words
 * appear anywhere in `@deckxi/shared`.
 */
import type { RoleDefinition, StatDefinition, StatGroup, Team } from "@deckxi/shared";

export const WWE_EDITION_ID = "edition-wwe-2026-q4";

/** Brands, not nations: the roster a wrestler appears on. */
export const WWE_TEAMS: Team[] = [
  { id: "raw", name: "Raw", shortName: "RAW", color: "#c62828" },
  { id: "smackdown", name: "SmackDown", shortName: "SD", color: "#1565c0" },
  { id: "nxt", name: "NXT", shortName: "NXT", color: "#f9a825" },
  { id: "legends", name: "Hall of Fame", shortName: "HOF", color: "#6a1b9a" },
];

export const WWE_ROLES: RoleDefinition[] = [
  { id: "main-eventer", name: "Main eventer", shortName: "ME" },
  { id: "powerhouse", name: "Powerhouse", shortName: "PWR" },
  { id: "high-flyer", name: "High flyer", shortName: "HF" },
  { id: "technician", name: "Technician", shortName: "TEC" },
];

/** The card's two columns: what they won on the left, what they do on the right. */
export const WWE_STAT_GROUPS: StatGroup[] = [
  { id: "gold", name: "The gold", icon: "belt" },
  { id: "craft", name: "Ring craft", icon: "mic" },
];

/**
 * Eight stats, four a column. Bounds are fixed rather than refitted: they are
 * the honest ceiling of the sport's record (Ric Flair's 16 world titles,
 * Bruno Sammartino's 2,803-day reign, the Undertaker's WrestleMania run), not
 * a property of who happens to be in the deck.
 *
 * `debutYear` is the deck's "lower wins" stat, and the one that makes a call
 * feel different from cricket: the oldest name in the hand beats the newest,
 * so a legend card is never dead weight.
 */
export const WWE_STATS: StatDefinition[] = [
  { key: "worldTitles", blurb: "How many times they have held a world championship.", name: "World title reigns", group: "gold", short: "Titles", direction: "higher", format: "integer", min: 0, max: 17 }, // prettier-ignore
  { key: "titleDays", blurb: "Their longest single reign as world champion, in days.", name: "Longest reign (days)", group: "gold", short: "Days", direction: "higher", format: "integer", min: 0, max: 3000 }, // prettier-ignore
  { key: "maniaWins", blurb: "Matches won at WrestleMania.", name: "WrestleMania wins", group: "gold", short: "Mania", direction: "higher", format: "integer", min: 0, max: 26 }, // prettier-ignore
  { key: "debutYear", blurb: "The year they debuted. Earlier wins — the one stat here that lower takes.", name: "Debut year", group: "gold", short: "Debut", direction: "lower", format: "integer", min: 1955, max: 2025 }, // prettier-ignore
  { key: "micSkill", blurb: "Our own 0-100 rating of how they work a crowd on the microphone.", name: "Mic skill", group: "craft", short: "Mic", direction: "higher", format: "integer", min: 0, max: 100 }, // prettier-ignore
  { key: "impact", blurb: "Our own 0-100 rating of how much a finisher ends a match.", name: "Finisher impact", group: "craft", short: "Impact", direction: "higher", format: "integer", min: 0, max: 100 }, // prettier-ignore
  { key: "heightCm", blurb: "Billed height in centimetres.", name: "Height (cm)", group: "craft", short: "Height", direction: "higher", format: "integer", min: 150, max: 230 }, // prettier-ignore
  { key: "weightKg", blurb: "Billed weight in kilograms.", name: "Weight (kg)", group: "craft", short: "Weight", direction: "higher", format: "integer", min: 45, max: 250 }, // prettier-ignore
];

/** Which stats are a matter of record, and which are our own judgement. */
export const WWE_SOURCES = [
  {
    name: "Wikipedia / Wikidata",
    url: "https://en.wikipedia.org/wiki/List_of_WWE_champions",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    note: "Title reigns, longest reign, WrestleMania wins, debut year, billed height and weight",
  },
  {
    name: "Wikimedia Commons",
    url: "https://commons.wikimedia.org/",
    license: "Per file: CC BY, CC BY-SA, CC0 or public domain",
    note: "Card photographs, credited per card",
  },
  {
    name: "DeckXI editorial",
    url: "https://github.com/RishikeshSreekumar/deckxi",
    license: "CC BY-SA 4.0",
    note: "Mic skill and finisher impact are our own 0–100 ratings, not a record of anything",
  },
];

/**
 * The three powers, re-skinned (#143). The mechanics are power-trumps' own
 * and are not touched — a re-skin is copy, so a second sport costs no engine
 * surface, no new redaction cases and no new tests. What changes is that the
 * card in your hand reads like the sport you are playing:
 *
 * - `powerplay` → **Run-In**: help arrives, and the beating is bigger.
 * - `drs` → **Cash-In**: the briefcase, played on someone else's moment.
 * - `super-over` → **Rematch Clause**: the loser invokes it, on the champion.
 */
export const WWE_POWERS = {
  powerplay: {
    name: "Run-In",
    short: "RUN",
    tag: "the numbers game",
    blurb: "Win and take one extra card from every loser. Lose and give one extra.",
    when: "Play it with your card, on your call or your answer.",
    win: "Take one extra card from every wrestler you beat.",
    fail: "Give one extra card away.",
  },
  drs: {
    name: "Cash-In",
    short: "MITB",
    tag: "your moment, their match",
    blurb:
      "Overrule the call with a stat of your own. Win and you call next. Lose one extra if not.",
    when: "Only when answering someone else's call — tap the stat you cash in on.",
    win: "Your stat decides the round, and you call next.",
    fail: "Give one extra card away.",
  },
  "super-over": {
    name: "Rematch Clause",
    short: "RC",
    tag: "one more match",
    blurb:
      "Lose the round, and your next card faces the winner's next card on the same stat. Win that and you take everything they just won.",
    when: "Play it with your card. It only fires if you lose the round — win or tie and you keep it, unspent.",
    win: "Your next card beats theirs on the called stat: you take every card they just won, and theirs too.",
    fail: "Your next card loses as well, and goes to them with the rest.",
  },
};
