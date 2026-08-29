# Classic Trumps — Rule Specification

Status: **authoritative**. The engine implements this document; when they disagree, this document
wins and the engine has a bug. Rule changes land here first, then in code.

## Overview

2–6 players. A deck of cards is dealt out evenly. Each round, the **leader** picks a stat from
their top card; every player reveals their top card; the best value on that stat takes all
revealed cards (plus any carried pot). The last player holding cards wins.

## Terminology

- **Card** — an id plus a map of numeric stat values. The engine is data-agnostic: cards and stat
  definitions are supplied in the game config (Phase 2 editions plug in here).
- **Stat definition** — `key`, `direction` (`higher` or `lower` wins — e.g. bowling economy is
  `lower`), and `min`/`max` bounds used for normalisation (auto-play, bots, UI bars).
- **Hand** — an ordered queue of cards, top card at the front. Won cards join at the **bottom**.
- **Leader** — the player who picks the stat this round (the "turn holder").
- **Pot** — cards carried over from tied rounds, awarded to the next round winner.
- **Active player** — still holds cards and has not forfeited.

## Setup

1. Config: seat-ordered player list (2–6), deck, stat definitions, RNG `seed`, `maxRounds`
   (default **1000**).
2. The deck is shuffled with a Fisher–Yates shuffle driven by the seeded RNG.
3. Cards are dealt round-robin starting at seat 0. **All cards are dealt**; when the deck does not
   divide evenly, earlier seats hold one extra card.
4. The first leader is chosen uniformly by the seeded RNG.

Everything random happens here. Given the same config (including seed), the entire game is
deterministic from this point on.

## Round flow

1. **Select** — the leader picks a stat available on their top card. Only the leader may act; any
   other player's select is rejected.
2. **Reveal** — every active player's top card is revealed with its value for the chosen stat.
   A card missing the chosen stat is treated as **worst possible** (`min` for higher-wins stats,
   `max` for lower-wins).
3. **Resolve** — the best value wins (respecting stat direction):
   - **Single best** → that player wins the round. All revealed cards plus the entire pot go to
     the bottom of the winner's hand, in this exact order: pot cards first (oldest first), then
     revealed cards in seat order starting from the round's leader. The winner leads the next
     round.
   - **Tie for best** (two or more players share the best value) → **all** revealed cards (from
     every player, not just the tied ones) are appended to the pot, in seat order starting from
     the leader. The leader stays the same — unless the leader was eliminated by the tie (played
     their last card), in which case leadership passes to the next active player clockwise (by
     seat order).
4. **Eliminate** — any player whose hand is now empty becomes inactive. The round winner can never
   be eliminated (they just received cards).
5. **Win check** — see win conditions.

## Elimination

- A player with an empty hand is eliminated immediately after the round resolves.
- Losing your last card to the round winner eliminates you.
- Putting your last card into the pot on a tie eliminates you; that card stays in the pot and is
  awarded with it later.

## Forfeit / leaving

- Any active player may forfeit at any point in the game (in a live room this covers both the
  "leave" button and disconnect-grace expiry — the server decides _when_, the engine decides
  _what happens_).
- The forfeiting player's entire hand is appended to the pot (top card first). They become
  inactive.
- If the forfeiting player was the leader, leadership passes to the next active player clockwise.
- If only one active player remains, that player wins immediately (reason: `opponents-forfeited`)
  — regardless of card counts.

## Turn timers & auto-play

The engine has **no clock**. Timers are owned by the host (server, Phase 4). When the leader's
timer expires, the host issues an `AUTO_PLAY` command for the leader. Auto-play picks the
leader's **best stat** deterministically:

- Normalise each stat on the top card: `(value − min) / (max − min)`, inverted for lower-wins
  stats. Missing stats normalise to 0. A stat with `min === max` normalises to 0.
- Pick the highest normalised value; break ties by stat-definition order in the config.

The resulting round is resolved exactly as if the leader had picked that stat (the event records
that it was automatic).

## Win conditions

Exactly one winner, always:

1. **Last standing** — after a round resolves (or a forfeit), only one active player remains →
   they win. (Holding _all_ cards is a special case of this: everyone else got eliminated.)
2. **Round limit** — if `maxRounds` rounds resolve without a last-standing winner, the game ends.
   Winner = most cards in hand (pot cards count for nobody); tie-break: lowest seat index. This
   guarantees termination — trumps can cycle forever in theory.

## Determinism & event sourcing

- The engine is a pure state machine: `applyCommand(state, command) → events[]` and
  `reduce(state, event) → state`. No `Math.random()`, no `Date.now()`, no I/O.
- The first event (`GAME_STARTED`) stores the full config — seed included — and the dealt hands.
  Replaying an event log through `reduce` reconstructs the exact game state at any point.
- Invalid commands are rejected with a reason code and produce **no** events.

## Edge cases decided

| #   | Case                                                          | Ruling                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deck doesn't divide evenly                                    | Deal everything; earlier seats get one extra card                                                                                                                                                                                                                                                                                             |
| 2   | Card missing the selected stat                                | Treated as worst possible value for that stat                                                                                                                                                                                                                                                                                                 |
| 3   | Stat missing on the **leader's** card                         | Leader may not select it (rejected)                                                                                                                                                                                                                                                                                                           |
| 4   | All revealed values tie                                       | Everything to pot, same leader (unless eliminated)                                                                                                                                                                                                                                                                                            |
| 5   | Leader's last card enters pot on a tie                        | Leader eliminated; leadership passes clockwise                                                                                                                                                                                                                                                                                                |
| 6   | Tie between exactly the last two players, both play last card | Both eliminated would leave no winner → the round-limit rule can't apply; ruling: **both survive is impossible**, so the tie stands, both are eliminated, and the winner is decided as in the round-limit rule among the just-eliminated tied players: most cards (0 each) → lowest seat index of the tied players wins (reason: `final-tie`) |
| 7   | Forfeit while not the leader                                  | Allowed; hand to pot; play continues                                                                                                                                                                                                                                                                                                          |
| 8   | Forfeit leaving one player                                    | Immediate win for the remaining player                                                                                                                                                                                                                                                                                                        |
| 9   | Command from a non-leader / eliminated / unknown player       | Rejected, no state change                                                                                                                                                                                                                                                                                                                     |
| 10  | Select in a finished game                                     | Rejected                                                                                                                                                                                                                                                                                                                                      |
| 11  | `maxRounds` reached                                           | Most cards wins; tie → lowest seat index                                                                                                                                                                                                                                                                                                      |
| 12  | Two-player game, one forfeits before round 1                  | Remaining player wins (`opponents-forfeited`)                                                                                                                                                                                                                                                                                                 |
