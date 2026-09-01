# DeckXI visual direction

Status: **decided** — 2026-08-30. Closes #96, unblocks #97–#111.

This document exists so the token rewrite is the execution of a decision rather than an
argument about hex codes. Everything below is a commitment; if a later issue wants to
depart from it, change this file first.

> **Amended 2026-09-01 — the board-game turn.** The game table was rebuilt in a
> printed-board-game language (thick ink outlines, hard offset drop shadows, a warm
> paper ramp, a yellow band and a green field) and it beat Floodlit on its own screen.
> That language is now the whole app's, not the table's: the palette moved into the
> semantic tokens and the table's `--tbl-*` names are aliases onto them. §2, §3 and §6
> below are amended in place; the exploration record in "Explorations considered" is
> kept as written, since C **was** the right call at the time and the ramp swap is a
> re-skin of the structure C established, not a rejection of it. In the vocabulary of
> that section this is exploration **B — Paper**, taken seriously the second time:
> texture is still refused, and the warmth is carried by flat colour and outlines,
> which cost nothing on a mid-tier Android.

---

## 1. What DeckXI feels like

> A cricket board game out of its box on a table. Everything is printed and cut out —
> outlined, dropped on its own shadow — and the cards are the pieces you hold.

Confident and sporty, with a physical, collectible quality to the cards themselves.
Quick to read at arm's length on a phone held in one hand.

(The original metaphor was "a floodlit night match … the cards are the only thing
glowing". It is kept here because it still describes the dark theme's job: the paper
ramp in dark is a lit table in a dark room, not a grey app.)

**What we are explicitly not:**

| Not this                  | Because                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A casino app              | No coin shine, no chrome bevels on chrome, no reward-loop confetti. The tension comes from the stat you pick, not from slot-machine dressing. |
| A corporate dashboard     | No grey card on grey background with a lone blue button. Panels are allowed colour and depth.                                                 |
| A fantasy-sports terminal | No dense data tables outside the card face. Stats live on cards; the app around them stays quiet.                                             |

## 2. Chrome vs. cards

**Cards are the hero. Chrome is furniture.**

Concretely, this is a saturation and elevation budget:

- The card face may use full team colour, foils, glow and gradient. It is the only
  element allowed a coloured glow.
- App chrome — panels, buttons, banners, lists — uses the paper ramp plus **one**
  accent. No panel gets a gradient. No panel gets a shadow larger than
  `--elevation-raised`.
- Only one accent-filled element should be on screen at a time: the primary action.
  Everything else is outline or ghost.
- Status colour (win / danger / warning) is used for text and borders, not fills, except
  in the results panel where the outcome _is_ the content.

**How a piece is drawn (2026-09-01).** Every chrome element that a player can press,
read as an object, or pick out of a list is a printed piece: `--edge` of `--ink-line`
around it, one hard offset drop from `--elevation-*`, and a flat fill. Three
consequences that are rules, not taste:

- **Elevation is offset, not blur.** `--elevation-raised` is `3px 3px 0` in the outline
  colour; card and overlay steps are the same shadow, further out. There is no soft
  shadow anywhere in chrome.
- **Pressing moves the piece into its shadow** (`translate(3px, 3px)`, drop removed).
  Nothing in chrome scales on press any more — a scaling outline reads as a wobble.
- **Fills carry their own ink.** The yellow band (`--surface-band`) and the green field
  (`--surface-field`) are surfaces with `--text-on-band` / `--text-on-field` beside
  them. Text on a fill never uses the theme's `--text-primary`, and never a raw white.

Two fills exist so the accent stays scarce: the band is decoration (heads, ribbons, the
called stat), the accent is action. A screen may show both, but only one _accent_.

Practical test: squint at the game table. The card in your hand should be the brightest
thing on screen, then the primary button, then everything else.

## 3. Dark and light are both first-class

**Dark is the default.** Light is fully supported, not a courtesy.

The reason is the product, not fashion: DeckXI gets played outdoors and in daylight, on
phones at low brightness. A light theme that has never been designed is a light theme
that gets abandoned mid-match.

Consequences that bind the colour work (#98):

- Both themes are _designed_, mapping semantic roles onto ramps. Light is not an
  override block of hand-picked lighteners.
- The OS preference (`prefers-color-scheme`) is the default; an explicit user choice
  overrides it and persists.
- The toggle lives in app chrome, not in the dev-facing `/cards` gallery.
- Rarity foils get **per-theme treatment**. A gold foil tuned for near-black reads as
  mud on near-white; the light-theme foils lean darker and more saturated, and the
  glows become tighter and lower-opacity.
- Every text-on-surface pair is checked to WCAG AA, with the results recorded in
  [`contrast.md`](./contrast.md) so it is re-checkable rather than remembered.

## 4. Typography

**Personality:** geometric-leaning sans with slightly rounded terminals. Sporty without
being a jersey-number face. Numerals are the workhorse — stat values, ratings, timers,
room codes — so tabular figures and unambiguous digits matter more than display flair.

**Decision on a webfont: not in v2.** We ship a tuned system stack behind
`--font-sans` / `--font-display` / `--font-mono` tokens.

Why, given that "the product's identity is card design":

1. The identity carries in the card _construction_ — frame, shield, meters, foils — far
   more than in the letterforms.
2. #107 sets a mobile budget on a mid-tier Android over 4G. A display face plus a text
   face is the single largest avoidable payload in a redesign.
3. Every consumer of the token layer (app, canvas export, OG composition) has to load
   the same face or exports drift from the app. That is real machinery for a change
   nobody has asked for yet.

This is a deferral, not a rejection. Because the family is a token, adopting a webfont
later is a one-file change plus a preload — the work is scoped and cheap. Revisit when
there is a brand identity to serve, and treat it as its own issue with a measured
before/after against the #107 budget.

**Scale rules:** every step pairs a size with a line-height and a weight — a step is a
complete typographic decision, not a font-size. The display end is fluid (`clamp()`) so
headings shrink on phones without per-screen overrides. Nothing renders below 12px, and
**no form input is below 16px** (iOS zooms the viewport otherwise).

## 5. Density on phones

Comfortable, not compact. DeckXI is a party game played at speed with one thumb.

- Gutter: 16px on phones, growing to 24 / 32 on tablet and desktop.
- Minimum touch target: **44 × 44 CSS px**, no exceptions, enforced by `--touch-min`.
- Panel padding 16px on phones. Vertical rhythm between sections is 24px.
- The game table is the exception that proves the rule: vertical space there is scarce,
  so it gets a tighter rhythm (12px) and earns it by having fewer elements.

## 6. Motion

Keep the existing vocabulary — `sheen`, `flip-in`, `pop`, `rise`, `deal-in`,
`win-sweep`, `pot-sink`. It was built with care and it reads well. Retune rather than
replace, along one axis:

> **Cards may perform. Chrome may not.**

- Card motion (deal, flip, sweep, foil sheen) is expressive and can overshoot slightly.
  It is the game's punctuation.
- Chrome motion (toasts, dialogs, banners, hover, focus) is nearly invisible: short,
  eased-out, no bounce, no scale. If you notice it, it is too much.
- Nothing animates a layout-triggering property. Transform and opacity only — this is
  also a #107 budget line.
- `prefers-reduced-motion` keeps every _state_ (the holo tint, the winner ring) and
  drops every _journey_ (the sweep, the sheen travel).

Durations: chrome `--dur-fast` (140ms), card transitions `--dur-med` (260ms), set-piece
card moments `--dur-slow` (440ms). Slightly quicker than v1 across the board — the v1
timings read as sluggish once several fire in sequence during a reveal.

---

## Audit: what is wrong today

Taken from a read of `packages/ui/src/styles.css` (713 lines) and
`apps/web/src/styles.css` (1070 lines) at `98b9679`, screen by screen.

### System-level

| Area            | Finding                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token tiers     | One flat tier. `--bg-panel` is simultaneously a value and a role, so "warm the accent slightly" is a hand-edit of every related shade.                                                      |
| Token drift     | `tokens.ts` is a hand-maintained mirror of `styles.css`. Nothing enforces it; the failure mode is exported card PNGs that no longer match the app.                                          |
| Type            | **No `--font-family` token at all.** The app renders in the OS stack, so it looks materially different on iOS, Android and Windows.                                                         |
| Type scale      | A fixed rem ladder, no line-height / weight / tracking tokens, no fluid behaviour. `--text-2xl` at 2.6rem is oversized on a phone.                                                          |
| Space           | `4/8/12/16/24/32`, and the app stylesheet is full of `6/10/14/18px` — the scale is missing rungs, and has nothing above 32 for page rhythm.                                                 |
| Radii           | `6/8/10/14` — four values inside an 8px band, with no stated use each. Four literal `999px` declarations that should be a token.                                                            |
| Elevation       | `--shadow-1                                                                                                                                                                                 | 2   | 3` with no stated meaning. Which surface gets which is currently vibes. |
| Breakpoints     | **One** width media query in the entire codebase (`min-width: 720px`, used twice), plus one landscape rule. That is a shape, not a responsive system.                                       |
| Safe areas      | Bottom edge only, while `viewport-fit=cover` is set — so notches and rounded corners can clip on the sides and top, and will in landscape.                                                  |
| Touch           | No `touch-action`, no `-webkit-tap-highlight-color`, no `overscroll-behavior`, no gesture handling anywhere. iOS paints its grey flash on every tap and pull-to-refresh can fire mid-match. |
| Theme           | No `prefers-color-scheme` hook. The only toggle in the product lives in `/cards`, is not persisted and is unreachable from the app.                                                         |
| Visual coverage | `/cards` only, one 1280×900 viewport. The table, lobby, results, profile and history screens have none — and they are where the redesign changes most.                                      |
| PWA             | Nothing. No `apps/web/public/`, no manifest, no icons, no service worker.                                                                                                                   |

### Screen-level

| Screen     | Finding                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing    | Hero type is a fixed 2.6rem that crowds a small phone. The profile chip is absolutely positioned at a raw `14px` inset and ignores the safe area. Join-code input is 1.1rem — above the iOS zoom threshold, but by accident, not by rule.                                                                                                                                             |
| Lobby      | The only screen with a second column, at the lone 720px breakpoint. QR is a fixed 132px square regardless of viewport. Chat log is capped at a raw `160px` and does not respond to available height.                                                                                                                                                                                  |
| Game table | The screen that matters most and the least protected. `min-height: 200px` on `.table-center` fights the hand and opponent rail for vertical space on a short phone. The landscape rule is a stopgap keyed to `max-height: 480px`. Opponent rail scrolls horizontally with no scroll affordance. `.hand-card-back` hardcodes two hex values — the only colour offenders left app-side. |
| Reveal     | Sequenced animation delays are hardcoded per slot (`0.15s` steps) rather than tokenised, so retuning motion means editing the reveal.                                                                                                                                                                                                                                                 |
| Results    | Fixed `3rem` trophy and `1.6rem` title; gold glow on the won-panel is a raw rgba rather than a token.                                                                                                                                                                                                                                                                                 |
| Profile    | `.stats-row` is a hard `repeat(4, 1fr)` — four tiles are cramped below ~360px. Avatar grid minmax of 56px yields awkward gutters on a large phone.                                                                                                                                                                                                                                    |
| History    | `.match-row` padding is off-scale (`12px 14px`) and does not match panel padding elsewhere, which is the "spacing that does not quite line up" reported in playtesting.                                                                                                                                                                                                               |
| Privacy    | Headings override the panel heading style inline-ish (`text-transform: none`) rather than using a distinct role.                                                                                                                                                                                                                                                                      |
| Chrome     | `.conn-banner` hardcodes `#241a02` and sits above the safe area. Toasts are bottom-centred at a fixed 16px and will collide with the game table's hand.                                                                                                                                                                                                                               |

Counted across the app stylesheet: **101** raw-px `gap`/`padding`/`margin`/`border-radius`
declarations against **3** token usages (#90).

---

## Explorations considered

Three directions were sketched against the game table — the hardest screen to satisfy
and the one that decides whether the product feels good. These were evaluated as
described designs against the criteria above, not rendered as comps; the pick was clear
enough on the "cards are the hero" test that comping all three would have been
ceremony.

**A — Broadcast.** Sports-broadcast lower-thirds: angled panel edges, a saturated team
colour bar down the side of every surface, heavy condensed type.
_Rejected._ Two competing colour systems on screen — the chrome's team bar and the
card's team frame — and the cards lose. Also ages badly and is a nightmare in light
theme.

**B — Paper.** Cards as physical objects on a felt table: warm neutrals, soft shadows,
a subtle texture on the surface behind the hand.
_Rejected, with regret._ It flatters the cards and the tactile quality is right. But it
pushes hard toward a light-first palette, which inverts our default, and texture is the
first thing to go wrong on a mid-tier Android at low brightness. Keeping the shadow
warmth as a light-theme note.

**C — Floodlit (picked).** Deep blue-black neutral ramp, one cool accent, near-flat
chrome with a single elevation step, and _all_ the glow budget spent on the cards.
Light theme is the same structure at inverted luminance with tightened foils.
_Picked_ because it is the only one of the three where the card is unambiguously the
brightest object on the table, it survives both themes without a redesign, and it costs
nothing in payload — the whole direction is expressible in tokens.

C is also the smallest step from where we are, which is deliberate. Phase 3 produced a
competent system; the problem was never that it looked wrong, it was that it was
unstructured, desktop-shaped and untyped. The redesign is mostly about fixing that.
