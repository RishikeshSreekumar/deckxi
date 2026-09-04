# Power Trumps — Rule Specification

Status: **authoritative**. The engine implements this document; when they disagree, this document
wins and the engine has a bug. Rule changes land here first, then in code.

Power trumps is classic trumps (`classic-trumps.md`) with four changes that give every seat a
decision every round. Everything not mentioned here — the deal, ties, the pot, elimination,
forfeit, the round limit, determinism — is exactly as in classic trumps.

## The four changes

1. **Choose your card.** Each round every active player plays one of the **top three** cards in
   their hand (fewer if they hold fewer). The rest of the hand stays in order.
2. **The call rotates.** The lead passes one seat clockwise every round, whether the round was won
   or tied. It does not go to the winner. (Exception: a winning DRS, below.)
3. **No repeat call.** The leader may not call the stat that decided the previous round — unless
   it is the only stat on their chosen card.
4. **Three power cards**, each held once per player for the whole game, at most one declared per
   round, in the window between the leader's call and the reveal. Every power is the same bet —
   _"my card is strong"_: **it pays big when the round goes your way and costs exactly one extra
   card when it does not.**

## Round flow

1. **Call** — the leader commits a card (index 0–2 of their hand) and a stat on it, and may
   declare **Powerplay** or **Super Over** with it. The state moves to `responding`. The call and
   the declared power are public; the card is not.
2. **Answer** — every other active player commits a card (index 0–2) and may declare one power.
   Their card stays hidden; the power kind is public. A DRS's chosen stat is the reviewer's secret
   until the reveal. Answers arrive in any order. A player may not answer twice.
3. **Reveal** — once every active player has committed, all committed cards turn face up on the
   **deciding stat**: the DRS stat if a DRS was declared, otherwise the leader's call. Best value
   wins as in classic; a shared best is a tie.
4. **Settle** — the reveal settles the classic way (winner takes pot then reveals in seat order
   from the leader; a tie sends every revealed card to the pot).
5. **Powers** — in seat order from the leader, Powerplay and DRS play out, then every Super Over.
   All card movement is recorded as an explicit ledger on the `ROUND_RESOLVED` event, applied after
   step 4.
6. **Next lead** — the next active seat clockwise from the round's leader, or the DRS caller if
   their DRS won.
7. **Eliminate / win check** — as classic.

If a player forfeits mid-round their committed play is withdrawn along with their hand (which goes
to the pot). If they were the last answer outstanding, the round resolves among those still in.

## The powers

Notation: _extra card_ = the top card of the player's hand after their revealed card has left it.
A player with no card left to give gives nothing (they are already being eliminated).

### Powerplay

Declared by anyone.

- **Win the round** → take one extra card from **every** other revealed player (to the bottom of
  your hand, seat order from the leader).
- **Lose the round** → give one extra card to the winner.
- **Tie** → the bet is lost: one extra card to the pot.

### DRS

Declared by a non-leader only (the leader has nothing to review). Names a stat that must differ
from the call. The round is decided on the DRS stat instead of the call — for everyone.

- **Win** → the pot as normal, **and you lead the next round** (rotation resumes from you).
- **Lose** → one extra card to the winner.
- **Tie** → one extra card to the pot.

One DRS per round: a second DRS declaration in the same round is rejected.

### Super Over

Declared by anyone. Fires only if you **lost** the round outright (a single winner, not you).

- Your next top card is played against the pot holder's next top card, on the deciding stat.
  - **You strictly beat it** → you take **everything the winner gained this round** (pot, reveals,
    any Powerplay forfeits) plus both Super Over cards. Your own Super Over card goes to the bottom
    of your hand.
  - **Otherwise** (they win or it ties) → your Super Over card goes to them. That is the one extra
    card.
- **You won or the round tied** → the bet is off: the power is **handed back**, unused (`void`).
- **No card left to play** → void as well.

With several Super Overs in one round they resolve in seat order from the leader, each against
whoever holds the round's winnings at that moment.

## Auto-play

The host runs one clock per **phase**: the leader's while they call, then one for the whole
responding window (an answer landing does not restart it). On expiry:

- Leader: their best callable stat on their **top** card (index 0), no power.
- Every responder still to answer: their **top** card, no power.

## Commands & events

- `SELECT_STAT { stat, cardIndex?, power? }` — leader only, `selecting` phase. `power` may not be
  DRS.
- `PLAY_CARD { cardIndex, power? }` — non-leaders, `responding` phase.
- `AUTO_PLAY` — as above for whichever phase is open.
- `STAT_SELECTED` gains `cardId` and `power`; new `CARD_PLAYED { playerId, cardId, power, auto }`.
- `ROUND_RESOLVED.stat` is the **deciding** stat; `ROUND_RESOLVED.power` carries `calledStat`,
  `drsBy`, `outcomes[]` (`won` | `lost` | `void`), `superOvers[]`, the `transfers[]` ledger, and
  `nextLeader`. The reducer applies the ledger verbatim and spends every non-void power.

On the wire, `cardId` on `STAT_SELECTED` / `CARD_PLAYED` is redacted to `null` for everyone but its
owner, and a DRS's `stat` is stripped for everyone but the reviewer.

## Edge cases decided

| #   | Case                                             | Ruling                                                                   |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | Chosen card's only stat is last round's stat     | Leader may call it (the no-repeat rule never leaves nothing to call)     |
| 2   | Leader declares DRS                              | Rejected (`power-not-allowed`)                                           |
| 3   | DRS names the called stat                        | Rejected                                                                 |
| 4   | Two DRS in one round                             | Second is rejected                                                       |
| 5   | Powerplay winner, a loser has no extra card      | That loser gives nothing                                                 |
| 6   | Power bet lost on a tie                          | Extra card to the pot                                                    |
| 7   | Super Over declared, round tied or won           | Void: power handed back                                                  |
| 8   | Super Over challenger ties the defender's card   | Challenger loses the bet (must strictly beat)                            |
| 9   | Leader forfeits while answers are outstanding    | Their play is withdrawn; rotation continues from their seat              |
| 10  | Last outstanding answerer forfeits               | Round resolves at once among the rest                                    |
| 11  | Everyone but the leader is gone when they call   | Round resolves immediately (the leader "wins" their own card back)       |
| 12  | DRS winner would be eliminated                   | Impossible — a round winner always holds cards                           |
| 13  | Rotation lands on a player eliminated this round | Lead passes to the next active seat clockwise (reducer rule, as classic) |
