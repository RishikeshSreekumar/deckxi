# Squad Draft — Rule Specification

Status: **authoritative**. The engine (`packages/engine/src/modes/squadDraft`) implements this
document; when they disagree, this document wins and the engine has a bug. Rule changes land here
first, then in code.

Squad Draft is the platform's second game and its first strategy mode: no hidden hands, no luck of
the deal — a shared pool everyone can see, a draft where every pick is a decision, an XI where
every slot is a trade-off, and a league where card stats and role fit decide who wins.

## Overview

2–4 players. A pool of cards is laid face up. Players take turns drafting one card each in a snake
order until every squad holds **13**. Each player then names an **XI** from their squad — a batting
order, five bowlers and a keeper — without seeing anyone else's. Every XI then plays every other
XI once, across three match phases. Two points a win, one a draw. The top of the table wins.

## Terminology

- **Card** — an id, a map of numeric stat values, and (used here, ignored by trumps) a `role`
  (`batter`, `bowler`, `all-rounder`, `keeper`) and a `nation`.
- **Pool** — the cards still available to draft, in a fixed layout order.
- **Squad** — the 13 cards a player drafted.
- **XI / roster** — a squad's chosen eleven: `order` (batting order, 11 cards), `bowlers` (5 of
  those 11, in bowling order), `keeper` (one of the 11).
- **Facet** — one of `batting`, `bowling`, `fielding`: a card's strength at one thing, 0–100.
- **On the clock** — the player whose pick it is.
- **Active player** — has not forfeited.

## Setup

1. Config: seat-ordered player list (2–4), the pool, stat definitions, the RNG `seed`, and the
   sizes (`squadSize` 13, `xiSize` 11, `bowlerCount` 5, `nationCap` 4) plus a **facet map** —
   which stat keys feed each facet. The default map is by conventional key name
   (`battingAvg`, `strikeRate`, `runs`, `highest` → batting; `wickets`, `economy`, `bestBowling` →
   bowling; `catches` → fielding); keys the edition does not define are dropped, and a facet left
   with no keys scores 0 for every card.
2. The pool must hold at least `13 × players + 5` cards, so the last picker still chooses.
3. The pool is shuffled with a Fisher–Yates shuffle driven by the seeded RNG; that order is the
   layout order for the whole game.
4. The pick order is a **snake**: seat order in round one, reversed in round two, and so on for
   13 rounds (`a b c | c b a | a b c …`).

Everything random in the draft happens here. The matches roll one more thing from the same seed
(form, below). Given the same config the whole game is deterministic.

## Phase 1 — Drafting

1. The player on the clock picks any card from the pool (`DRAFT_PICK { cardId }`). Anyone else's
   pick is rejected (`not-on-the-clock`); a card not in the pool is rejected (`card-not-in-pool`).
2. **Nation cap.** A squad may hold at most `nationCap` (4) cards from any one nation; a pick that
   would exceed it is rejected (`nation-cap`). Cards with no nation never count. If _no_ legal pick
   exists, the cap is waived for that pick (edge case 3) — the draft can never stall.
3. The card leaves the pool and joins the bottom of the picker's squad. `CARD_DRAFTED` records the
   pick's overall number (1-based) and whether it was automatic.
4. When every active player's squad is full the draft ends (`DRAFT_COMPLETED`) and the game moves
   to `building`.

A forfeited player's remaining picks are skipped; their squad is frozen where it stands and plays
no further part.

## Phase 2 — Building

Each active player submits one roster (`SUBMIT_XI { roster }`), blind. A roster is legal when:

- `order` has exactly `xiSize` (11) distinct cards, all from the submitter's squad;
- `bowlers` has exactly `bowlerCount` (5) distinct cards, all in `order`;
- `keeper` is in `order`.

Anything else is rejected (`invalid-roster`, with the reason). A second submission is rejected
(`already-submitted`). Nothing about the XI is constrained beyond its shape — the trade-offs are
paid for in the scoring, not forbidden: a keeper who cannot keep, a batter asked to bowl, a tail
of specialists.

`XI_SUBMITTED` is public as a fact but the roster inside it is **redacted for everyone but its
owner** until the matches are played. When the last active player's XI is in, the matches play at
once.

## Phase 3 — The matches

### Card strength

- `facet(card, f)` = `100 × mean(normalised value of each stat key in facet f)`, using the trumps
  normalisation (`(value − min) / (max − min)`, inverted for lower-wins stats, missing stats 0).
  Rounded to one decimal.
- **Role weights.** A card asked to bat counts its batting facet × `BAT_WEIGHT[role]`
  (`batter`, `keeper`, `all-rounder` 1.0; `bowler` 0.6). A card asked to bowl counts its bowling
  facet × `BOWL_WEIGHT[role]` (`bowler`, `all-rounder` 1.0; `batter` 0.5; `keeper` 0.25). Unknown
  roles bat at 1.0 and bowl at 0.5. Fielding is never weighted.
- **Form.** Every card in every XI gets a multiplier in `[0.9, 1.1]`, rolled once per game from
  a second RNG stream derived from the seed, consumed in a fixed order (active players in seat
  order, each `order` front to back). Form multiplies every facet contribution. It is recorded on
  `MATCHES_PLAYED` so a client never has to recompute it.
- **Overall** (auto-picks and the bot only): `0.45 × batting + 0.40 × bowling + 0.15 × fielding`,
  role-weighted.

### One match (home v away)

Each phase produces a score for each side; the higher score wins the phase, equal scores are a
dead heat (no winner). All groups are **averaged**, so group sizes never bias a phase.

| Phase              | Home score                                                                 | Away score |
| ------------------ | -------------------------------------------------------------------------- | ---------- |
| **Powerplay**      | avg batting of home `order[0..3)` − avg bowling of away `bowlers[0..2)`    | symmetric  |
| **Middle overs**   | avg batting of home `order[3..7)` − avg bowling of away `bowlers[2..5)`    | symmetric  |
| **Finish & field** | avg batting of home `order[7..11)` + avg fielding of home `order` + gloves | symmetric  |

**Gloves**: `+10` if the named keeper's role is `keeper`, `−10` otherwise.

Match result: more phases won wins; equal phases → the larger total margin (`Σ home − away`)
wins; equal margin → draw.

### The league

Every active side plays every other once; the earlier seat is home. Two points a win, one a
draw. The table is ordered by points, then total margin, then seat order — so it always has a
strict first row. That row's player wins (`GAME_ENDED { reason: "league" }`).

## Forfeit / leaving

- Any active player may forfeit at any point (leave button, disconnect grace expiry, kick).
- **Drafting**: their remaining pick slots are skipped. If theirs were the only slots left, the
  draft completes for those still in.
- **Building**: they are out; the matches play among the others. If every other XI is already in,
  the matches play at once.
- If one active player remains, they win immediately (`opponents-forfeited`), whatever the phase.

## Turn timers & auto-play

The engine has no clock. The host runs one clock per **pick** while drafting (`turnKey`
`draft:<slot>`) and one clock for the whole building phase (`turnKey` `building`) — an XI
landing does not restart it for the others. On expiry the host issues `AUTO_PLAY`:

- **Drafting**: the strongest legal card by overall; ties to pool (layout) order.
- **Building**: the **auto-roster** — the best keeper-role card keeps (else the best fielder in
  the XI), the strongest five bowlers by weighted bowling bowl (in that order), the strongest
  batters fill the rest, and the batting order is by weighted batting strength.

The baseline bot drafts by overall too, nudged by need (a squad with no keeper wants one from the
halfway point; a squad short of bowling wants bowlers while it still can), and builds with the
auto-roster.

## Commands & events

- `DRAFT_PICK { playerId, cardId }`, `SUBMIT_XI { playerId, roster }`, `AUTO_PLAY { playerId }`,
  `FORFEIT { playerId }`.
- `GAME_STARTED { config, pool, pickOrder }` · `CARD_DRAFTED { playerId, cardId, pick, auto }` ·
  `DRAFT_COMPLETED` · `XI_SUBMITTED { playerId, roster, auto }` · `PLAYER_FORFEITED { playerId }`
  · `MATCHES_PLAYED { rosters, form, league }` · `GAME_ENDED { winner, reason }`.

On the wire, `GAME_STARTED` drops the seed; `XI_SUBMITTED.roster` is `null` for every viewer but
its owner. Everything else is public.

## Edge cases decided

| #   | Case                                              | Ruling                                                       |
| --- | ------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Pick from a player not on the clock               | Rejected (`not-on-the-clock`), no state change               |
| 2   | Pick would be a fifth card from one nation        | Rejected (`nation-cap`) while any legal pick exists          |
| 3   | No legal pick under the cap                       | Cap waived for that pick; the whole pool is legal            |
| 4   | Card with no nation                               | Never counts toward the cap                                  |
| 5   | Forfeit while drafting                            | Their slots are skipped; squad frozen; draft continues       |
| 6   | Forfeit while building, every other XI already in | Matches play at once among the rest                          |
| 7   | Forfeit leaving one player                        | Immediate win (`opponents-forfeited`)                        |
| 8   | Named keeper is not a keeper                      | Legal; costs the gloves penalty in every match               |
| 9   | Batter named as a bowler                          | Legal; bowls at half strength                                |
| 10  | Phase scores equal                                | Dead heat: no phase point either way                         |
| 11  | Equal phases and equal margin                     | Draw: one point each                                         |
| 12  | Equal points and margin in the table              | Earlier seat ranks higher (the table always has one top row) |
| 13  | Facet with no stat keys in the edition            | Scores 0 for every card                                      |
| 14  | Command in a finished game                        | Rejected (`game-finished`)                                   |
| 15  | Trumps command sent to a draft (or vice versa)    | Rejected (`unknown-command`)                                 |
