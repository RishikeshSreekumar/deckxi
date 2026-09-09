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

### The card's columns, decks and powers are the edition's too

A trump card has two columns. What they are _called_, and which stats sit in them, is
`statGroups` + each stat's `group` — a cricket card prints Batting and Bowling, a WWE card prints
The gold and Ring craft, and an edition that declares neither gets two unlabelled columns filled
evenly. The stat's `short` is its cramped label on the card and its `blurb` is the line the rules
sheet prints; both used to be a hard-coded cricket table in the UI.

Decks are the same story. "Batters' XI" is a cricket idea, so it lives in the cricket edition's
data file, not in `@deckxi/shared`; the deck catalogue seeds itself from every bundled edition and
tags each deck with the edition it belongs to, so a WWE room is never offered a bowlers' deck and
the two "All Stars" are two different sets of cards. Operator-curated decks (`/admin`) name their
edition in the query string and default to the current one.

Powers are copy, not mechanics. `edition.powers` renames a power and rewrites the three lines it
prints; the mode's rules are untouched, which is the whole trick — `powerplay` prints as **Run-In**
on a WWE card and still takes one extra card off everyone it beat. An edition that says nothing
keeps the cricket originals.

### `format: "figures"` is cricket-only

A packed bowling analysis (`wickets * 100 + (99 - runs)`, printed `w/r`). `integer` and `decimal`
are universal; an edition of another sport simply never uses `figures`.

## Ids

`edition-<slug>`: `edition-2026-q3` for the shipped cricket edition, `edition-fixture` for the
fictional test one, `edition-wwe-2026-q4` for the wrestling one (`docs/wwe-edition.md`).
`settings.editionId` on the wire validates the same shape.

## On the client

Only the default edition is in the initial payload — a second one is ~7 kB gzipped of JSON for a
deck most sessions never open, and the perf budget is why the lobby loads as fast as it does. Any
other edition is fetched the moment a screen names it (`ensureEdition` in `@deckxi/ui`, the
`useEdition` hook in the web app), so a room, a `/deck?edition=` link or the lobby's edition picker
pulls it in on demand. `getEdition` stays synchronous, because every card render calls it.
