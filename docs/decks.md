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

Every built-in deck can deal the biggest table in full (6 players × 11 cards = 66); a server test
checks that against the shipped edition. When a deck cannot cover the room's players × cards
each, the lobby warns and the server deals what there is.

## Curating decks (#142)

The four decks above ship in the bundle as the defaults every deployment boots with, and are what
the client renders before the catalogue arrives. Beyond them, decks are **runtime content**: an
operator adds, edits, retires and deletes them from the admin console (`/admin`, behind the
existing `ADMIN_TOKEN` / `ADMIN_EMAILS` auth — there is no separate deck password), and the
catalogue is stored in one `app_config` row, so it survives a restart without a deploy.

A deck is defined one of two ways:

- a **filter** — roles and/or rarities over the pinned edition, which is what the built-ins are;
  an absent filter matches everything. Role ids are the edition's own vocabulary
  (`docs/editions.md`), so a role the pinned edition never declared is refused at write time, and
  the four built-in decks above are cricket ones;
- an **explicit card list**, which overrides the filters when present: a hand-picked XI.

Because deck ids are now open, `deckId` is a **slug on the wire** (`[a-z0-9]+(-[a-z0-9]+)*`), not
an enum: the catalogue decides which slugs exist, and a room set to an unknown one is refused with
`bad-request`. The catalogue reaches the client at `GET /api/decks` (public: id, name, blurb, card
count), one deck's cards at `GET /api/decks/:id/cards`, and the room snapshot carries the resolved
deck so a lobby still prints what it is playing with after a rename.

Writes are validated whole — every card id must exist in the edition, no duplicates, and the deck
must resolve to at least six cards (the smallest table) — and the operator behind each one is
logged. `all-stars` cannot be deleted: it is the deck every room falls back to.

**A running game never changes.** The cards are drawn and recorded in `GAME_STARTED` when the game
starts, exactly as the edition is pinned, so editing a deck mid-match cannot touch the table.

A deck that needs cards or stats the edition does not have is a new edition, not a deck.

| Route                            | Does                                  |
| -------------------------------- | ------------------------------------- |
| `GET /api/admin/decks`           | the catalogue, definitions included   |
| `POST /api/admin/decks`          | create                                |
| `PATCH /api/admin/decks/:id`     | name, blurb, filters, enabled, sort   |
| `PUT /api/admin/decks/:id/cards` | explicit membership (`null` to clear) |
| `DELETE /api/admin/decks/:id`    | delete (refused for the default deck) |
