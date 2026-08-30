# Visual regression

```sh
pnpm --filter @deckxi/web test:visual                     # check
pnpm --filter @deckxi/web test:visual --update-snapshots  # refresh baselines
```

Needs only the built SPA — no game server, no database — so it runs in seconds and is
cheap enough to sit in the loop of a design change.

## What is covered

| Suite                        | Screens                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `e2e-visual/cards.spec.ts`   | `/cards` gallery: sizes and states, rarities in both themes, the full edition grid, the 1200×630 OG share composition |
| `e2e-visual/screens.spec.ts` | Lobby, game table (your turn, and mid-reveal with the verdict up), results — each in both themes                      |

Viewports are Playwright projects:

| Project           | Viewport                    | Runs            |
| ----------------- | --------------------------- | --------------- |
| `phone-sm`        | 360×640                     | screens         |
| `phone`           | 390×844 (iPhone 13 metrics) | screens + cards |
| `phone-landscape` | 844×390                     | screens         |
| `tablet`          | 834×1112                    | screens         |
| `desktop`         | 1280×900                    | screens + cards |

The gallery is viewport-insensitive by nature and expensive to diff (64 cards of text), so
it runs on two projects rather than five. The app screens run everywhere, because that is
where a mobile-first layout actually breaks — and it did: adding these projects is what
surfaced the table overflowing a 360×640 phone and the landscape layout never fitting at
all.

## How the app screens are driven

Not from a live server. `src/dev/visualFixtures.ts` seeds the real store with literal
state and the app renders exactly as it would in a game:

```
/__visual/lobby        /__visual/table-turn
/__visual/table-reveal /__visual/results
```

The fixture rewrites the URL to `/` and skips session and socket setup, so no screenshot
can catch a connection banner mid-frame. Card ids come from the bundled edition in order,
so nothing depends on a shuffle or a clock. The route only exists when the bundle is
built with `VITE_VISUAL=1`, which the visual config's `webServer` does; a normal
production build never imports the module.

The reveal is a timed sequence that would race the screenshot, so the `table-reveal`
fixture holds the verdict open via `revealTiming` in `GameTable.tsx` — a mutable export
that nothing in the running app writes.

## Themes

Every screens test runs twice. The light pass goes through the **real toggle** rather
than setting `data-theme` directly, so a green light baseline also proves the in-app
control works. The config pins `colorScheme: "dark"`, because the token CSS answers
`prefers-color-scheme` now and an unpinned scheme would make every baseline depend on the
OS setting of whoever ran it.

## Baselines are darwin-only, and this is a local gate

Baselines are per-platform and only the darwin set is committed. **The visual suite does
not run in CI.**

That is a deliberate choice, not an oversight. Font rasterisation, emoji glyphs and
subpixel rounding differ enough between macOS and CI Linux that a second baseline set
would need its own refresh discipline, and the failure mode of getting that wrong —
a suite that is permanently red and therefore permanently ignored — is worse than not
running it. A silently broken visual gate is worse than no visual gate.

The trade is that a visual regression can reach `main` if nobody runs the suite. Revisit
by generating Linux baselines in a container that matches CI exactly (`--update-snapshots`
inside the CI image, not on a developer machine) and adding a job; until then, running it
is part of reviewing a design change.

## Refreshing baselines

One commit, nothing else in it:

```sh
pnpm --filter @deckxi/web test:visual --update-snapshots
git add apps/web/e2e-visual
git commit -m "test(web): refresh visual baselines — <what changed and why>"
```

A reviewer distinguishes an intentional change from a regression by the diff being
**alone in its commit** and the message saying what moved. A baseline refresh mixed into
a feature commit is unreviewable, which is the same as unreviewed.
