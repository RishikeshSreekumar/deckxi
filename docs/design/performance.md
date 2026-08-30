# Mobile performance budget

A redesign is where weight sneaks in — a webfont, richer shadows, more animation, larger
card art. The realistic DeckXI player is on a mid-tier Android on a patchy connection, and
without a budget any regression stays invisible until someone complains.

```sh
pnpm --filter @deckxi/web budget         # report
pnpm --filter @deckxi/web budget:check   # fail if over (runs in CI)
```

## The budget

Enforced, from `apps/web/performance-budget.json`:

| Budget               | Limit  | At the redesign |
| -------------------- | ------ | --------------- |
| Initial JS, gzipped  | 150 kB | 134.3 kB        |
| Initial CSS, gzipped | 12 kB  | 7.9 kB          |
| Initial requests     | 6      | 4               |
| Font payload         | **0**  | 0               |

"Initial" means what a first-time visitor downloads before the app can render: the entry
module, everything `index.html` preloads alongside it, and the stylesheet. Route chunks
that load later are excluded — splitting them out is the point.

Field-side targets, checked by hand before a release on a throttled mid-tier Android
profile over 4G (Chrome DevTools → Performance → CPU 4× slowdown, Fast 4G):

| Metric | Target   |
| ------ | -------- |
| LCP    | ≤ 2.5 s  |
| INP    | ≤ 200 ms |

## Baseline and direction of travel

Measured at `98b9679`, immediately before the redesign: **one** 469.9 kB chunk, 147.3 kB
gzipped, plus 7.8 kB of CSS — everything in the initial download, including the card
gallery, the privacy page and `qrcode`.

After: 134.3 kB gzipped across three initial chunks, with profile, history, privacy, the
gallery, the share view and `qrcode` split out. The redesign added a larger token layer
and more CSS and still came out lighter, which is the point of measuring rather than
assuming.

## Why a bundle gate and not Lighthouse CI

Lighthouse numbers on shared CI runners move several hundred milliseconds run to run.
A threshold tight enough to catch a real regression is flaky; one loose enough to be
stable catches nothing. Either way the job gets ignored, and an ignored gate is worse than
no gate.

Payload is deterministic, and payload is what actually regresses when a redesign adds
weight. So CI gates payload, and the field metrics are a release-time manual check
documented above. If we later want continuous field data, the answer is RUM from real
sessions, not synthetic runs on a noisy runner.

## Standing decisions that keep us inside the budget

- **No webfont.** The single largest avoidable payload in a redesign. `--font-sans` /
  `--font-display` / `--font-mono` are tokens over a tuned system stack, so adopting one
  later is a one-file change plus a preload — and must come with a measured before/after
  against this budget. See [`direction.md`](./direction.md) §4.
- **Transform and opacity only.** Every animation in the motion vocabulary is
  compositor-friendly; nothing animates a layout-triggering property. This is a
  performance line as much as a craft one.
- **Route splitting is the default for anything off the path into a game.** The eager
  bundle is exactly what a player needs to land, join and play.
- **Card art is inline SVG**, not image requests — it costs bytes once in the bundle
  rather than a request per card.

## When the gate fails

Split the weight out of the initial chunk. Raising the number in
`performance-budget.json` is allowed but must be a decision with a reason in the commit
message, not a reflex.
