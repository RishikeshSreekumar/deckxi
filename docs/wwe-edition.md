# The WWE edition

Status: **authoritative** for what the WWE edition is made of and where it came from (#143).

`edition-wwe-2026-q4` is the platform's second sport, and the reason it exists is to prove the
first one was not baked in: it ships as data, in one repository, on one deploy, sharing every line
of the engine, the rooms, the lobby, the bots and the replay debugger with cricket. Nothing in
`packages/engine` or `packages/shared` knows it is about wrestling.

Build it with `pnpm --filter @deckxi/data build-wwe` (add `--photos` to download and crop the
card art, `--refresh-people` to re-resolve Wikidata).

## What is in it

62 cards across four brands — Raw, SmackDown, NXT and the Hall of Fame — in four roles:
main eventer, powerhouse, high flyer, technician. The card's two columns are **The gold** and
**Ring craft**, and its eight stats are:

| Stat                 | Direction | Where it comes from      |
| -------------------- | --------- | ------------------------ |
| World title reigns   | higher    | Public record            |
| Longest reign (days) | higher    | Public record            |
| WrestleMania wins    | higher    | Public record            |
| Debut year           | **lower** | Public record            |
| Mic skill            | higher    | **Our own 0–100 rating** |
| Finisher impact      | higher    | **Our own 0–100 rating** |
| Billed height (cm)   | higher    | Public record            |
| Billed weight (kg)   | higher    | Public record            |

**Debut year is the deck's "lower wins" stat**, and it is what makes a WWE call feel different
from a cricket one. Cricket gets one lower-wins stat (economy) and it is a specialist's number;
here the oldest name in your hand always has something, so a legend card is never dead weight.

Two stats are editorial and say so on the card's own rules sheet: mic skill and finisher impact
are our judgement, not a record of anything. The rest are matters of published fact, curated by
hand in `packages/data/sources/wrestlers.json` — there is no ball-by-ball archive to derive a
wrestling career from, and pretending otherwise would be the kind of false precision the cricket
importer exists to avoid.

## Names and photographs

Names are used descriptively, as any sports reference does. Card photographs are **Wikimedia
Commons files under free reuse licences only** — CC BY, CC BY-SA, CC0, public domain — resolved
per wrestler through Wikidata (matched on ring name or alias, constrained to people whose
occupation is professional wrestler, which is what keeps a namesake out of the deck) and checked
against Commons' own licence metadata before download. Author, licence and source are recorded per
card and printed at `/credits`, exactly as the cricket edition does. 61 of 62 cards carry a photo;
the one that does not keeps the role silhouette.

No promotional artwork, no title-belt graphics, no company logos, no scraped images.

## What it does not play

`supportedModes` is `classic-trumps` and `power-trumps` only. Squad Draft drafts an XI, names five
bowlers and hands someone the gloves — it is a cricket game, and generalising it would produce a
lie rather than a mode. The lobby offers the intersection of the mode registry and the edition, and
the server refuses the rest with `mode-unsupported`.

## Its decks and its powers

Four decks, none of them a translation of a cricket one: the full roster, the Hall of Fame,
**The Giants** (powerhouses and main eventers, where height, weight and the finisher settle almost
every call) and **Workrate** (technicians and high flyers, where the mic and the impact do). Both
role decks are the same eight stats reading completely differently, which is the point of a deck.

The three powers are re-skinned, not re-invented — the mechanics are power-trumps' own:

| Power        | Prints as          | The rule (unchanged)                                            |
| ------------ | ------------------ | --------------------------------------------------------------- |
| `powerplay`  | **Run-In**         | Win and take one extra card from every loser; lose and give one |
| `drs`        | **Cash-In**        | Overrule the call with a stat of your own                       |
| `super-over` | **Rematch Clause** | Only if you lose: your next card faces the winner's             |

A re-skin is copy in `edition.powers`, so a second sport costs no engine surface, no new redaction
cases and no new tests — see `docs/editions.md`.
