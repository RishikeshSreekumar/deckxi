# Editions

An **edition** is the complete dataset a game is played on: stat definitions, roles, teams and
player cards, validated by `editionSchema` in `packages/shared/src/edition.ts` and loaded from
`packages/data/editions/*.json`. A room pins one (`settings.editionId`), so a data refresh never
changes what is on a running table.

Editions are **not cricket-specific** (#143). The trumps engine never looks at what a stat or a
card means — it compares numbers — and the schema now keeps the same discipline, so a second
sport is a dataset rather than a second app.

## What an edition declares

| Field            | Why                                                                         |
| ---------------- | --------------------------------------------------------------------------- |
| `sport`          | `cricket`, `wrestling`… lets the UI pick its vocabulary and art direction   |
| `series`         | Optional: the competition or era, where it narrows the sport                |
| `supportedModes` | The game modes this edition can be played in                                |
| `stats`          | 6–10 stats, each with `direction`, `format` and honest `min`/`max` bounds   |
| `roles`          | The edition's own roles: `{ id, name, shortName }`                          |
| `teams`          | Nations, brands, stables — whatever the sport groups cards by               |
| `players`        | The cards; each carries a `role` id from `roles` and a value for every stat |

### Roles are the edition's vocabulary, not the schema's

`player.role` used to be `z.enum(["batter", "bowler", "all-rounder", "keeper"])`. That made every
other sport choose between forking the app and lying about its cards — a "keeper" that means
"technician" confuses everyone, permanently. An edition now declares its own roles and each card
carries one of their ids; the schema checks membership. Deck role filters
(`packages/shared/src/decks.ts`), the `/deck` filter chips, the admin deck editor and the card's
role label and glyph all read the edition's list. A role this build has no art for falls back to a
neutral figure rather than a blank corner.

The rule this sets, going forward: **a mode owns its vocabulary.** Sport-specific words live in
`packages/engine/src/modes/<mode>/` or in an edition data file — never in
`packages/shared/src/edition.ts` or `packages/engine/src/types.ts`. Squad Draft genuinely knows
about bowlers, keepers and overs, so its cricket words stay inside `modes/squadDraft/`, and the
cricket ingest path's own vocabulary lives in `packages/data/src/cricket.ts`.

### `supportedModes` is what keeps Squad Draft cricket-only

Generalising Squad Draft would produce a lie, so instead the edition says which modes it can be
played in. The lobby offers the intersection of the mode registry and `supportedModes`, and the
server holds the same line at room creation, at every settings change and at game start
(`mode-unsupported`) — a client that asks anyway is refused rather than seated in a game whose
rules its cards cannot mean anything under.

### `format: "figures"` is cricket-only

A packed bowling analysis (`wickets * 100 + (99 - runs)`, printed `w/r`). `integer` and `decimal`
are universal; an edition of another sport simply never uses `figures`.

## Ids

`edition-<slug>`: `edition-2026-q3` for the shipped cricket edition, `edition-fixture` for the
fictional test one, `edition-wwe-2026-q4` for a sport that is not cricket. `settings.editionId` on
the wire validates the same shape.
