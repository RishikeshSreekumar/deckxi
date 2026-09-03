# Card data sources

Status: **authoritative** for where card data comes from and what we owe for it (#88). The
importer in `packages/data/src/import/` implements this document.

## Summary

| What                    | Source                                                                                                                                          | Licence                                                                                                | Obligation                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Career statistics       | [Cricsheet](https://cricsheet.org/) men's T20I ball-by-ball data                                                                                | [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/)                                             | Attribute Cricsheet; state the licence                        |
| Person identity mapping | [Cricsheet register](https://cricsheet.org/register/) (`people.csv`)                                                                            | ODC-By 1.0                                                                                             | As above                                                      |
| Full player names       | [Wikidata](https://www.wikidata.org/), matched by ESPNcricinfo id (P2697)                                                                       | [CC0](https://creativecommons.org/publicdomain/zero/1.0/)                                              | None (credited anyway)                                        |
| Player photographs      | [Wikimedia Commons](https://commons.wikimedia.org/), the file Wikidata lists as the person's image (P18) or one tagged as depicting them (P180) | Per file: CC BY, CC BY-SA, CC0, public domain, or a government open licence — nothing else is accepted | Credit the author, name and link the licence, link the source |

Attribution is printed in the app at `/credits` (linked from the privacy page and the deck view)
and is carried in the edition file itself: `edition.sources[]` for the datasets and
`player.photo` for each photograph. Nothing in the shipped edition is typed in by hand.

## What was decided

**Statistics — Cricsheet, derived by us.** ESPNcricinfo and Cricbuzz license their compilations and
forbid scraping. Cricsheet publishes the underlying ball-by-ball record under an attribution licence,
so we fold every delivery into per-player totals ourselves and derive the eight card stats from those.
That sidesteps the database-compilation question entirely: our aggregates are our own work from open
data.

**Format — men's T20 Internationals only.** One format keeps every card comparable (a Test average
and a T20 average are different animals), and T20I is the one with complete Cricsheet coverage
(every match since the first in 2005) and the widest recognition. Numbers are the player's T20I
career, which is what fans argue about. Domestic leagues (IPL, BBL…) are excluded: partial coverage
and franchise trademarks.

**Teams — nations, not franchises.** Franchise names, crests and colours are trademarks; country
names are not. Every card carries the player's national side (the team they appeared for most) and
nothing else, so the licensing question never arises. Colours are our own frame colours per nation,
not board branding.

**Art — licensed photographs where they exist, silhouettes where they don't.** A likeness needs a
licence. Wikimedia Commons hosts photos of most international cricketers under Creative Commons
attribution licences (or an open-government licence for the many Indian players photographed at the
Prime Minister's Office). The importer accepts only reuse-with-attribution licences — no NC, no ND,
no fair use — and records author, licence and source per card. Cards with no acceptable photo keep
the role silhouette — but squad selection prefers players who _have_ one (below), so today 176 of
210 cards carry a photo; the silhouettes are mostly Scotland, Zimbabwe, Netherlands, Ireland and
Nepal players whose nations have no further photographed candidates. A better photo for a player can be pinned in
`sources/overrides.json`.

**Fictional data stays for tests.** The Phase 2 generated deck lives on as `edition-fixture`. The
visual-regression suites, the drift tests and the admin-CLI tests run against it, so a weekly refresh
of the real deck never moves a baseline pixel.

## Derivation rules

For each person (keyed by Cricsheet register id), over every men's T20I in the archive:

| Card stat       | Derivation                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batting average | runs ÷ dismissals (retired hurt / retired not out are not dismissals; 0 dismissals → runs)                                                                                                                              |
| Strike rate     | runs ÷ balls faced × 100; a wide is not a ball faced, a no-ball is                                                                                                                                                      |
| T20I runs       | sum of runs off the bat                                                                                                                                                                                                 |
| T20I wickets    | bowled, caught, caught & bowled, lbw, stumped, hit wicket (not run-outs, obstruction, etc.)                                                                                                                             |
| Economy         | runs conceded ÷ overs; byes, leg byes and penalties are not conceded; wides and no-balls are. A player with fewer than 12 balls bowled gets the worst plausible figure (12.0) so "lower wins" never rewards not bowling |
| Catches         | catches as a fielder, plus caught-and-bowled; substitute fielders are excluded                                                                                                                                          |

**Role** is inferred from the shape of the career (stumpings → keeper; balls bowled per match and
runs per match separate bowlers, all-rounders and batters) and can be forced per player in
`sources/overrides.json`.

**Squad**: for each of 14 nations (India, Australia, England, New Zealand, Pakistan, South Africa,
Sri Lanka, Bangladesh, West Indies, Ireland, Zimbabwe, Netherlands, Scotland, Nepal), 5 batters by
runs, 2 keepers, 3 all-rounders and 5 bowlers by wickets among players with at least 15 T20Is,
back-filled by overall involvement when a role is short. 210 cards. A game deals
`cardsPerPlayer × players` from a fresh shuffle of the whole pool, so a bigger pool means a
different deck every game.

**Stats**: batting average, strike rate, runs and highest score with the bat; wickets, economy,
catches and best bowling with the ball. Best bowling is an innings analysis ("3/17") packed into one
comparable integer (`wickets × 100 + (99 − runs)`, so more wickets always wins and fewer runs breaks
the tie); a player who has never bowled carries 0, printed as a dash. Highest score ignores not-outs.

**Shirt numbers**: no open dataset carries them (Wikidata's P1618 covers two of our players), so
`sources/overrides.json` holds a hand-curated list keyed by Cricsheet id. A card without one prints
its rating in the corner square instead of a number. Numbers change between kits — corrections go
in the same file.

**Faces before shape.** A card is a portrait first, so selection runs in two passes: the squad
shape is filled from players with a usable photograph (role seats, then back-fill by involvement),
and only the seats still empty go to players without one. A nation with no photographed keeper
fields an extra batter rather than a silhouette. Because whether a player has a photo is only known
once they are resolved, the importer selects, resolves the newcomers, marks the faceless, and selects
again until the squad stops changing — so a first run for a new nation makes several passes, and
`sources/people.json` accumulates the near-misses (that is the point: the next refresh needs no
network).

**Stat bounds** (`edition.stats[].min/max`, used for normalisation and bars) are refitted to the
selected deck on every import, rounded outwards to a round number.

**Rarity** is by derived-rating rank: the top eighth are legends, the next quarter stars, the rest
regular. Real distributions are skewed, so this is deliberately rank-based rather than threshold
based; the balance report (`pnpm --filter @deckxi/data check`) still gates on strict dominance.

### Known gaps

- Cricsheet withholds matches involving the Afghanistan men's team (see
  [their policy](https://cricsheet.org/withheld-matches/)). Afghanistan is therefore not a team in
  the deck, and every other player's totals omit their games against Afghanistan — Virat Kohli's
  T20I runs print a little under the ESPNcricinfo figure for that reason. This is documented on the
  credits page as "derived from _N_ men's T20 Internationals".
- Wikidata labels are occasionally the formal name ("Mohammad Babar Azam"); the name a player is
  known by is set in `sources/overrides.json`.

## Refreshing

```sh
pnpm --filter @deckxi/data import-cricsheet --photos
```

Downloads `t20s_male_json.zip` and `people.csv` into `packages/data/.cache/` (gitignored),
aggregates, selects the squad, resolves any **new** players on Wikidata/Commons into
`sources/people.json` (committed — a routine refresh does not touch the network for names or
photos), downloads and crops photos for newcomers into `apps/web/public/cards/<edition>/`, prunes
photos nothing refers to, refits bounds, re-derives ratings and rarity, bumps the edition version
only if something changed, and prints the balance report.

The Monday cron (`.github/workflows/edition-update.yml`) runs exactly this and opens a PR. To
re-resolve everyone's names and photos (e.g. after fixing an override), add `--refresh-people`.

`update-edition` (synthetic form drift) refuses editions that declare `sources`; it exists for the
fixture.
