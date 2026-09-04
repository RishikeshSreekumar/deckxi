# Auction XI — Paper Design (mode #3, not built)

Status: **design only**. Written to validate the `GameMode` interface against a third game that
is neither a trumps variant nor a draft (Phase 9, task 7). Nothing here is implemented; every
section ends with what the interface would need, and the last section lists what it lacks.

## Pitch

The IPL auction as a table game. A shared pool goes under the hammer one card at a time; every
player starts with the same purse; the highest bid takes the card. When the pool is sold, XIs are
named and the Squad Draft league decides it — so the whole new game is the _acquisition_ phase,
and the scoring is reused wholesale.

Why it is a good third mode: it has **simultaneous hidden information** (sealed bids), a
**resource** (the purse), and a **market** (a card is worth what the table thinks it is), none
of which trumps or the draft have. If the interface can host it, it can host most card games.

## Rules sketch

- 2–4 players, purse of 1000 each, pool of `11 × players + 8` cards, laid out in seeded order.
- **Lot**: the next pool card. All active players submit a **sealed bid** (0 = pass). Bids are
  hidden until every bid is in (like a power-trumps responding window).
- **Reveal**: highest bid wins the card and pays it; ties go to the bidder with fewer cards, then
  the earlier seat. Everyone passing → the card is discarded.
- **Constraints**: a squad may not exceed 13; a bid may not exceed the purse minus `(13 − squad)`
  reserve of 1 per unfilled slot (you can always afford to finish). Nation cap 4, as the draft.
- **End of auction**: pool empty, or every active player holds 13 (the rest of the pool is
  discarded). Squads short of 11 are topped up from the discard at the auto-roster's choice, free.
- **Build and league**: exactly Squad Draft's phase 2 and 3, reused.
- **Timer**: one clock per lot (`turnKey` `lot:<index>`); on expiry, unbid seats bid 0.
- **Forfeit**: purse and squad frozen; skipped for the remaining lots; the league plays among
  the rest.

## Mapping onto `GameMode`

| Hook            | Auction XI                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `players`       | `{ min: 2, max: 4 }`                                                                                                                                                                                |
| `deckSize`      | `11 × players + 8` (ignores `cardsPerPlayer`, as the draft does)                                                                                                                                    |
| `init`          | Validates, seeds the pool order, sets purses. `GAME_STARTED { config, pool }`                                                                                                                       |
| `reduce`        | `BID_PLACED` (bid hidden in state as `pending[playerId]`), `LOT_SOLD`, `LOT_PASSED`, `AUCTION_CLOSED`, then the draft's `XI_SUBMITTED` / `MATCHES_PLAYED` / `GAME_ENDED`                            |
| `apply`         | `BID { amount }` rejected as `not-bidding`, `already-bid`, `over-purse`, `squad-full`, `nation-cap`; when the last bid lands, the lot resolves in the same batch (like `PLAY_CARD` in power trumps) |
| `status`        | `phase` `auction` / `building` / `finished`; `waitingOn` = active players without a bid this lot; `turnKey` `lot:<i>`; `round` = lot number                                                         |
| `clientCommand` | `{ type: "BID", amount }` plus the draft's `SUBMIT_XI`                                                                                                                                              |
| `autoPlay`      | `BID { amount: 0 }` while bidding; the auto-roster while building                                                                                                                                   |
| `forfeit`       | `FORFEIT`                                                                                                                                                                                           |
| `redact`        | `BID_PLACED.amount` is `null` for everyone but the bidder until `LOT_SOLD`, which lists every bid; rosters as the draft                                                                             |
| `bot`           | Bids `overall × purse / remaining need`, capped by the reserve rule; the draft bot for building                                                                                                     |
| `inspect`       | Purses, squads, the pending bids, the pool                                                                                                                                                          |

Code reuse: `scoring.ts`, `autoRoster`, `rosterProblem` and the whole building/league phase are
importable as they stand. The shared wire types for rosters, matches and the league table are
reused verbatim; only `BID`, `BID_PLACED`, `LOT_SOLD`, `LOT_PASSED` and `AUCTION_CLOSED` are new.

## What the interface handles without change

- Simultaneous moves: `waitingOn` returns several players and `turnKey` holds for the lot, so
  the room's "one clock per key" rule gives the sealed-bid window for free (it already does this
  for power trumps' responding phase).
- Hidden information on a public event: `redact` per viewer covers a sealed bid exactly as it
  covers a committed trumps card.
- Reuse of another mode's phases: modes are plain modules, so the auction imports the draft's
  building and league code — no interface support needed, and no "mode inheritance".
- Kill switch, metrics, per-mode stats, the admin inspector, the replay debugger: all keyed on
  the mode id or on `status`/`inspect`.

## Gaps found (backlog, not blockers)

1. **Room settings are trumps-shaped.** `cardsPerPlayer`, `maxRounds` mean nothing here and a
   purse size would. The interface should let a mode declare its own settings schema
   (`settingsSchema?: ZodType`) that the lobby renders and the room validates, with
   `deckSize`/`init` receiving the parsed settings. Squad Draft dodged this by having no knobs.
2. **`ModeSetup` has no place for mode config.** Related: `init` takes players, cards, stats,
   seed and `maxRounds`. A `settings: unknown` slot (validated by the mode's schema above) is the
   clean fix.
3. **`ModeInspection.players[].cards` is one list per player.** An auction wants purse per
   player too; it fits in `detail` today, but a typed `extra: Record<string, unknown>` per
   player row would render better in the inspector.
4. **The client's mode registry is by hand.** `App.tsx` switches on `settings.gameMode` to pick
   the table screen and the store keeps one slice per mode family. A third mode makes that three
   branches; a small `clientModes` map (`{ fold, Table, Results }`) would keep it to one line
   per mode, mirroring the engine registry.
5. **Bots are only used by tests and timers.** "Play vs computer" (Phase 10) will want `bot`
   run by the room for a bot seat; the hook is there, the room loop is not.

None of these change the shape of `GameMode`; they add optional members. The interface is fit
for a third mode as it stands.
