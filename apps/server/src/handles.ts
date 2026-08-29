/**
 * Generated cricket-flavored handles for guest identities, so a fresh guest
 * shows up as "CoverDrive42" rather than "Anonymous".
 */
import { randomInt } from "node:crypto";
import { AVATARS } from "@deckxi/shared";

const SHOTS = [
  "CoverDrive",
  "SquareCut",
  "LateCut",
  "LegGlance",
  "StraightDrive",
  "OnDrive",
  "PullShot",
  "HookShot",
  "SlogSweep",
  "ReverseSweep",
  "UpperCut",
  "Paddle",
  "Flick",
  "Loft",
  "Scoop",
] as const;

const BALLS = [
  "Googly",
  "Doosra",
  "Yorker",
  "Bouncer",
  "OffCutter",
  "LegCutter",
  "ArmBall",
  "Inswinger",
  "Outswinger",
  "SlowerBall",
  "TopSpinner",
  "Carrom",
] as const;

/** e.g. "CoverDrive42" or "Googly7" — fits the 24-char name limit. */
export function generateGuestHandle(): string {
  const pool = randomInt(2) === 0 ? SHOTS : BALLS;
  const word = pool[randomInt(pool.length)] as string;
  return `${word}${randomInt(1, 100)}`;
}

/** A random avatar from the shared set, assigned to new guests. */
export function randomAvatarId(): string {
  return (AVATARS[randomInt(AVATARS.length)] as (typeof AVATARS)[number]).id;
}
