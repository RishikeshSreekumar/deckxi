/**
 * The decks the WWE edition ships with. Deliberately not a translation of the
 * cricket ones: "Batters' XI" has no wrestling equivalent, and a deck is only
 * worth having when it changes how a call feels.
 *
 * The two role cuts are the interesting pair — a giants deck makes height and
 * weight decide almost every round, and a workrate deck makes the mic and the
 * finisher decide instead, on the same eight stats.
 */
import type { EditionDeck } from "@deckxi/shared";

export const WWE_DECKS: EditionDeck[] = [
  {
    id: "all-stars",
    name: "The Full Roster",
    blurb: "Every card in the edition. Raw, SmackDown, NXT and the Hall of Fame.",
    sort: 0,
  },
  {
    id: "hall-of-fame",
    name: "Hall of Fame",
    blurb: "Legends only. Long reigns and early debuts — the low-debut call wins here.",
    rarities: ["legend"],
    sort: 1,
  },
  {
    id: "the-giants",
    name: "The Giants",
    blurb: "Powerhouses and main eventers. Height, weight and the finisher settle it.",
    roles: ["powerhouse", "main-eventer"],
    sort: 2,
  },
  {
    id: "workrate",
    name: "Workrate",
    blurb: "Technicians and high flyers. Smaller cards, so the mic and the impact decide.",
    roles: ["technician", "high-flyer"],
    sort: 3,
  },
];
