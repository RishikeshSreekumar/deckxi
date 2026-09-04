# PWA

DeckXI installs to a home screen and loads instantly on repeat visits. Everything is
configured in `apps/web/vite.config.ts` via `vite-plugin-pwa`; this file records the
decisions that are not obvious from the config.

## The one rule

> **Gameplay traffic never touches the service worker's cache.**

DeckXI has a constraint most PWAs do not: a live Socket.IO connection. Its polling
fallback issues real HTTP requests that a naive `NetworkFirst` handler would happily
cache — and a cached ack looks exactly like a server bug. By the time anyone diagnoses
it, the bad worker is on everyone's phone.

So `/socket.io/`, `/api/` and `/auth/` are declared `NetworkOnly` explicitly rather than
left to fall through as unmatched, and they are in `navigateFallbackDenylist`.
`e2e/pwa.spec.ts` plays far enough to generate socket traffic, then walks every cache the
worker owns and fails if a single gameplay or auth URL is in one.

## What is cached

| Class                                  | Strategy                                    |
| -------------------------------------- | ------------------------------------------- |
| App shell + hashed build assets        | Precache (Workbox), ~1 MB across 26 entries |
| Same-origin images (exported card art) | `CacheFirst`, 80 entries, 30 days           |
| `/socket.io/`, `/api/`, `/auth/`       | `NetworkOnly`                               |

## Updates are offered, never forced

`registerType: "prompt"`. A new worker waits; `UpdatePrompt` in `components/Chrome.tsx`
shows a quiet bar, and **refuses to appear at all while `room !== null`**. Reloading
mid-match costs the player the round even though the server would let them resume.

Because nothing calls `clientsClaim`, a freshly-registered worker does not control the
page until the next navigation. That is intended, and it is why `e2e/pwa.spec.ts` reloads
before asserting control.

The socket handshake carries `PROTOCOL_VERSION`, so a stale cached client can meet a
server that has moved on. That path already produces a clear message rather than a silent
failure — `protocol-mismatch` maps to "Your game is out of date — refresh the page" in
`lib/socket.ts`.

## Kill switch

If a bad worker reaches production:

1. Set `selfDestroying: true` in the `VitePWA(...)` options.
2. Ship.

The plugin then emits a worker whose only job is to unregister itself and delete its
caches. Every installed client picks it up on its next visit and returns to plain
network-served pages. Ship the fix afterwards, with `selfDestroying` removed.

## Offline

There is no separate `offline.html`. A cold start with no network serves the precached
shell, which renders the app's own offline state — one less artefact to keep in step with
the design, and the player lands somewhere they can act rather than on a dead end.

Connectivity is folded into `ConnectionStatus` in `store/store.ts`, which distinguishes
`reconnecting` (the server is unreachable) from `offline` (the device says it has no
network). They are identical to the code that retries but not to the player: telling
someone in a lift that we are "reconnecting, hang tight" is a hopeful lie. `call()` in
`lib/socket.ts` also fails immediately when `navigator.onLine` is false rather than
burning the 8s ack timeout to arrive at a worse answer.

Offline vs-bot practice (#85) rides on this worker: the shell and card art are already
cached, so that issue only needs the game loop.

## Install education

`InstallPrompt` waits until the player has actually been in a room before offering
anything — asking someone to install a game they have not played is how install prompts
earned their reputation. Android gets a real button via `beforeinstallprompt`; iOS Safari
has no such event, so it gets a hint pointing at Share → Add to Home Screen. Dismissal
persists, and nothing shows in standalone mode.

## Identity assets

`pnpm --filter @deckxi/web icons` regenerates everything in `apps/web/public/` from one
SVG in `scripts/generate-icons.mjs`, so the set cannot drift the way a folder of
hand-exported PNGs does. The mark is the card back's cricket-seam crest reduced until it
survives 48px: ring, two seam arcs, XI monogram. The radiating field lines and corner pips
are gone — they turn to mush below about 96px.

Colours are the dark theme's tokens. An app icon does not follow a theme, so it commits to
the product default.

**iOS splash screens are deliberately omitted.** `apple-touch-startup-image` needs one
asset per device size, forever, and iOS ignores the manifest's `background_color` for
splash regardless. The default is acceptable; the maintenance is not.

## Standalone mode

`display: standalone` means no back button and no URL bar. Every screen reachable outside
a room has an in-app route back to `/` in its header, and no flow depends on browser
chrome. `orientation: "any"` — the game table has a real landscape layout, so we never
lock the player out of turning the phone.

## Offline practice

Installing an app that does nothing without a network is a worse experience than not
installing it, so `#85` gives an offline player something to do: a full game against bots,
hosted on the device.

`apps/web/src/game/practice.ts` is that host. It does what the room manager does — draw a
deck from the bundled edition, `mode.init`, apply commands, fold events, redact them for
the single viewer — and the store folds the result through exactly the same
`ingestGameEvents` path as the socket. One folding path is the point: the table cannot
behave differently depending on who hosted the game, and the bots' hands stay hidden from
you because `mode.redact` does not know it is running in a browser.

Narrower than the server, on purpose:

- **No clock.** Nothing is waiting on you, and a countdown you cannot lose to is theatre.
- **No chat, no persistence, no rating.** Nothing here leaves the device.
- **Trumps only.** Squad Draft is a game about drafting against opponents whose picks are
  the point; the baseline bot would make it solitaire.

The module is loaded on demand (`await import`) because it pulls the whole engine with it
— about 10 kB gzipped that a player joining a friend's table never needs, and the initial
payload has a budget (#107). Workbox precaches the built chunk along with everything else,
so the download happens while you still have a network and the button works after you do
not.

The connection banner is suppressed while a practice game is running. Telling someone
mid-round that we are reconnecting is true of the socket and irrelevant to the game in
front of them.
