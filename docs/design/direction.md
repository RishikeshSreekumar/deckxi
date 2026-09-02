# DeckXI visual direction

Status: **decided** — 2026-08-30. Closes #96, unblocks #97–#111.

This document exists so the token rewrite is the execution of a decision rather than an
argument about hex codes. Everything below is a commitment; if a later issue wants to
depart from it, change this file first.

> **Amended 2026-09-02 — the cardboard turn (v4, current).** Mockup turn 7 —
> exploration **B — Paper**, calmed down — is the whole app. The floodlit v3 below
> stays as the record of the structure (two token tiers, both themes first-class, one
> accent, cards as the hero, the motion vocabulary); v4 re-skins it and changes three
> rules:
>
> - **Ground:** cream stock (`--cream-*`) with one ink (`--ink-900`) for every outline.
>   `--ink-line` is that ink, `--edge` is 2.5px, and there is no hairline anywhere.
> - **Elevation is a hard offset drop** of the same ink (`--elevation-*`: 3/4/6px). A
>   piece on the table has a drop; furniture that is part of the table is flat. **Press
>   sinks the piece into its drop** (`translate(4px, 4px)`, shadow off) — the one
>   translate chrome is allowed. Hover changes the fill.
> - **Accent:** one ember (`--ember-550` by day, `--ember-400` at night). Green
>   (`--leaf-*`) is a state — on, ready, won, the desktop field — never chrome.
> - **The card is cream stock in both themes**, outlined and dropped like every other
>   piece; its back is the deck's blue (`--sky-500`).
> - **Type:** Baloo 2 (bold, never uppercase) for the wordmark, headings, numerals and
>   buttons; Barlow for everything else, including the small uppercase eyebrow. Anton
>   and Barlow Condensed are gone.
> - **Screens:** each holds a single job. Landing is _host_ beside _join_ (six slots for
>   the code); the lobby is a grid of seats with the chat beside it and one action row;
>   the table puts the seats around a green field on a desktop and your card in a
>   column; profile is the settings screen, sectioned by label. Voice chat in the mock is
>   not built — the mic states are omitted, not faked.
>
> §2, §4 and §6 are amended by the rules above; the v3 text is kept as written.

> **Amended 2026-09-01 — the floodlit turn (v3, superseded).** Exploration **C —
> Floodlit** is back, and this time it is the whole app. The board-game skin below was
> the right structure with the wrong surface: a warm paper ramp with thick ink outlines
> and hard offset drops reads as a print mock-up rather than a night match, and it spent
> its contrast on the chrome instead of on the cards. v3 keeps every structural decision
> — the two token tiers, both themes first-class, one accent, cards as the hero, the
> motion vocabulary — and re-skins it:
>
> - **Ground:** a night-green ramp (`--night-*`) instead of the warm ink/paper ramp. The
>   lit green field (`--surface-field`, `--field-gradient`) is the table itself.
> - **Accent:** one gold (`--gold-400`). The yellow band and the orange ball are gone;
>   `--surface-band` is that same gold, so band and accent are one colour with two jobs.
> - **Edges and elevation:** a 1px gold hairline (`--ink-line`) and a soft downward drop.
>   The hard offset shadow is gone, and with it the press-into-shadow gesture: **nothing
>   lifts or moves on hover or press**, chrome dims instead.
> - **The card is paper, in both themes.** Bone face, dark ink, a team-colour bar across
>   the head rather than a team-colour band behind it. Its ink roles (`--card-body-ink`,
>   `--card-body-muted`, `--card-body-accent`, `--card-back-ink`) live in
>   `semantic.common`, because a printed object does not have a dark mode.
> - **Type:** the webfont deferral in §4 is lifted — see the note there.
>
> §2, §4 and §6 are amended in place. The v2 amendment below is kept as the record of
> why the structure looks the way it does.
>
> **Amended 2026-09-01 — the board-game turn (v2, superseded).** The game table was rebuilt in a
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

> A floodlit night match. The room is dark green, the table is the only lit thing in it,
> and the cards are the only paper — printed objects you hold, under a light.

Confident and sporty, with a physical, collectible quality to the cards themselves.
Quick to read at arm's length on a phone held in one hand.

(v2 read this as "a cricket board game out of its box on a table" — everything printed
and cut out, outlined, dropped on its own shadow. That metaphor survives in exactly one
place, and it is the right one: the card. Everything around it is the night.)

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
- App chrome — panels, buttons, banners, lists — uses the night ramp plus **one**
  accent. No panel gets a gradient (the lit field is not a panel). No panel gets a
  shadow larger than `--elevation-raised`.
- Only one accent-filled element should be on screen at a time: the primary action.
  Everything else is outline or ghost.
- Status colour (win / danger / warning) is used for text and borders, not fills, except
  in the results panel where the outcome _is_ the content.

**How a piece is drawn (v3).** Chrome is _cut out of_ the night rather than drawn on top
of it: a 1px hairline of `--ink-line`, no fill, and a soft drop only where a thing is
genuinely above the table. Three consequences that are rules, not taste:

- **Elevation is a floodlight drop.** `--elevation-*` is a soft, downward, hueless
  shadow, and it goes on cards, sheets and overlays — not on buttons, rows or chips. A
  screen has at most one elevated thing at a time.
- **Nothing lifts and nothing moves.** No hover translate, no press translate, no scale.
  Hover changes colour; press dims (`opacity: 0.72`). Under a floodlight attention is a
  colour, not a position.
- **Fills carry their own ink.** The gold band (`--surface-band`) and the green field
  (`--surface-field`) are surfaces with `--text-on-band` / `--text-on-field` beside
  them. Text on a fill never uses the theme's `--text-primary`, and never a raw white.
- **Gold on the green is not the theme's gold.** `--interactive-accent` is a dark bronze
  in light theme, which vanishes on grass. Anything landing on the field takes
  `--surface-band` (the table's own `--tbl-gold-on-field` alias), which is the same gold
  in both themes — as is the field, and as is the card.

One gold does both jobs — band and accent — so scarcity is the whole discipline: **one
accent-filled element per screen**, and everything else is a hairline.

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

**Decision on a webfont: adopted in v3.** The v2 deferral below was made when the
direction had no typographic idea to serve. The floodlit direction _is_ one — plate
numerals and condensed uppercase labels are half of what makes it read as a night match
— so the deferral is lifted. Three faces, loaded once in `index.html` with
`display=swap`, behind the same tokens as before:

| Token            | Face                 | Job                                                        |
| ---------------- | -------------------- | ---------------------------------------------------------- |
| `--font-display` | **Anton**            | Wordmark, headings, room codes, every stat value and timer |
| `--font-sans`    | **Barlow**           | Everything you read as a sentence                          |
| `--font-label`   | **Barlow Condensed** | The uppercase, widely tracked eyebrow that names a region  |
| `--font-mono`    | system stack         | Admin surfaces only                                        |

Two rules come with them. **Anton ships one weight**, so anything set in
`--font-display` also sets `--weight-regular` — a synthesised bold smears the face at
plate sizes, and the emphasis is meant to come from size. And **every stack still
degrades to a system face** that keeps the same voice, because `display=swap` means the
first paint of a match may well be the fallback.

The costs the v2 note raised are still real and still governed: the faces are subset by
Google Fonts to the weights listed above, `preconnect` is in the document head, and the
#107 budget check is the gate. The canvas export and OG composition read the same tokens,
so they cannot drift from the app.

> **v2 rationale (superseded).** Not in v2. We shipped a tuned system stack because the
> identity carries in the card _construction_ — frame, shield, meters, foils — more than
> in the letterforms; because a display face plus a text face is the single largest
> avoidable payload against the #107 budget; and because every consumer of the token
> layer has to load the same face or exports drift. It was recorded as a deferral, not a
> rejection, precisely so this change would be a one-file edit plus a preload.

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

**C — Floodlit (picked, and picked again).** Deep blue-black neutral ramp, one cool
accent, near-flat chrome with a single elevation step, and _all_ the glow budget spent
on the cards. Light theme is the same structure at inverted luminance with tightened
foils.
_Picked_ because it is the only one of the three where the card is unambiguously the
brightest object on the table, it survives both themes without a redesign, and it costs
nothing in payload — the whole direction is expressible in tokens.

_(v3 note: the ramp went night-**green** rather than blue-black and the accent went warm
gold rather than cool, which is the one thing this entry got wrong — a cool accent on a
neutral ground is a dashboard. Everything else here is what shipped.)_

C is also the smallest step from where we are, which is deliberate. Phase 3 produced a
competent system; the problem was never that it looked wrong, it was that it was
unstructured, desktop-shaped and untyped. The redesign is mostly about fixing that.
