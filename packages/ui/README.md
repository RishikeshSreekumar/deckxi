# @deckxi/ui

Design tokens, the TrumpCard renderer and the component kit.

```ts
import "@deckxi/ui/styles.css"; // tokens + kit styles
import { TrumpCard, Dialog, tokens } from "@deckxi/ui";
```

## Tokens

`tokens/tokens.json` is the **only** place a token value may be declared. Two files are
generated from it and both are committed:

| Generated                  | Consumed by                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `src/generated/tokens.css` | the app, via `@deckxi/ui/styles.css`                                     |
| `src/generated/tokens.ts`  | code that cannot read CSS — canvas, the card export pipeline, inline SVG |

```sh
pnpm tokens        # regenerate both
pnpm tokens:check  # fail if they are stale (runs in CI)
```

Editing a generated file directly is a no-op: CI fails and the next `pnpm build`
overwrites it. Before this pipeline existed the CSS and the TypeScript mirror were
maintained by hand and drifted silently, with the visible symptom being exported card
PNGs that no longer matched the app.

### Primitive vs. semantic — the one rule

Tokens come in two tiers, and **components consume semantics only**.

```
primitive   --navy-700, --sky-400        raw ramps and scales, theme-independent
semantic    --surface-panel, --text-accent   the role a component asks for
```

A theme is a remapping of semantics onto primitives. It never invents a raw colour, and
a component that reaches past the role — `color: var(--navy-300)` — is invisible to
theming and will look wrong in one of the two themes. If a component needs a role that
does not exist yet, add the role; do not reach for the ramp.

Composite values (gradients, shadows) are CSS-only and live under `composite` in the
source. Flat per-theme colours are mirrored into TypeScript as `Palette`.

### Breakpoints

`--bp-sm|md|lg|xl` exist for JavaScript and container queries. CSS media queries cannot
read custom properties, so width queries use the literal with the token named in a
comment beside it:

```css
/* --bp-md: tablet up */
@media (min-width: 768px) {
  ...;
}
```

## Direction

The visual direction these tokens encode — what DeckXI feels like, how much weight app
chrome may take next to the cards, the dark/light stance, the typography and motion
decisions — is in [`docs/design/direction.md`](../../docs/design/direction.md). Contrast
results for both themes are in [`docs/design/contrast.md`](../../docs/design/contrast.md).
