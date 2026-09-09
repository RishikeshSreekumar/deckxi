# Decks

A **deck** is the set of cards a room plays with. Every deck is a curated subset of the pinned
**edition** (`docs/data-sources.md`): the same cards, stats, teams and provenance, so choosing a
deck changes what turns up on the table without touching ratings, seasons, the collection or the
client bundle. Rooms carry `deckId` next to `editionId`; the host picks it in the lobby and the
server draws the game's cards from that deck's pool (`deckPool` in `packages/shared/src/decks.ts`).

| Deck           | Filter                 | Cards (2026 Q3) |
| -------------- | ---------------------- | --------------- |
| All Stars      | everything             | 210             |
| Legends        | star + legend rarity   | 79              |
| Batters' XI    | batters + keepers      | 92              |
| Bowlers' Union | bowlers + all-rounders | 118             |

Every deck must be able to deal the biggest table in full (6 players × 11 cards = 66); a server
test checks that against the shipped edition. When a deck cannot cover the room's players × cards
each, the lobby warns and the server deals what there is.

Adding a deck is one entry in `DECKS` (a name, a blurb, and role/rarity filters). A deck that needs
cards or stats the edition does not have is a new edition, not a deck.
