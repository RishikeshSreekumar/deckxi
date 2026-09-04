/**
 * Generated handles for guest identities. A table is a group of friends, so a
 * guest name has one job: be sayable out loud and tellable apart at a glance —
 * "SneakyYorker", not "Anonymous" and not "CoverDrive42". Two readable words,
 * cricket-flavoured, no digits: a number on the end reads like a serial and
 * nobody ever says it. The seat avatar prints the first letter, so the
 * adjective carries the initial and the pools spread across the alphabet.
 */
import { randomInt } from "node:crypto";
import { AVATARS } from "@deckxi/shared";

/** The initial. Spread across the alphabet so two seats rarely share a letter. */
const MOODS = [
  "Angry",
  "Bouncy",
  "Brave",
  "Cheeky",
  "Cool",
  "Crafty",
  "Dodgy",
  "Feral",
  "Filthy",
  "Grumpy",
  "Hasty",
  "Jolly",
  "Lazy",
  "Loud",
  "Lucky",
  "Mighty",
  "Nervy",
  "Nifty",
  "Quiet",
  "Reckless",
  "Rogue",
  "Rusty",
  "Salty",
  "Silky",
  "Sleepy",
  "Sneaky",
  "Spicy",
  "Turbo",
  "Wild",
  "Wonky",
] as const;

/** The thing they are. Short enough that two words clear the 24-char limit. */
const CRICKET = [
  "Allrounder",
  "Bails",
  "Batter",
  "Boundary",
  "Bouncer",
  "Bowler",
  "Century",
  "Chai",
  "Cover",
  "Crease",
  "Doosra",
  "Duck",
  "Fielder",
  "Fineleg",
  "Finisher",
  "Googly",
  "Gully",
  "Helmet",
  "Keeper",
  "Longoff",
  "Nightwatch",
  "Opener",
  "Pacer",
  "Pads",
  "Pavilion",
  "Seamer",
  "Sixer",
  "Skipper",
  "Slip",
  "Slogger",
  "Spinner",
  "Stumps",
  "Sweeper",
  "Swinger",
  "Tailender",
  "Thirdman",
  "Umpire",
  "Wicket",
  "Willow",
  "Yorker",
] as const;

/** e.g. "SneakyYorker" or "GrumpyUmpire" — fits the 24-char name limit. */
export function generateGuestHandle(): string {
  const mood = MOODS[randomInt(MOODS.length)] as string;
  const noun = CRICKET[randomInt(CRICKET.length)] as string;
  return `${mood}${noun}`;
}

/** A random avatar from the shared set, assigned to new guests. */
export function randomAvatarId(): string {
  return (AVATARS[randomInt(AVATARS.length)] as (typeof AVATARS)[number]).id;
}
