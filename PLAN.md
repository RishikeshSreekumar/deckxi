# DeckXI — Cricket Trump Cards Platform: Build Plan

An online multiplayer card game platform built around cricket trump cards. Players create rooms, friends join with a code, and they play trump-card games — starting with classic stat-comparison trumps and growing into deeper strategy modes. Card design is a first-class product feature. Player/team data is curated by us and refreshed on a schedule.

**Confirmed decisions:** curated + semi-real data (no licensed feeds) · full TypeScript stack · 2–6 player turn-based rooms · free/hobby-tier hosting first.

---

## Architecture at a glance

| Concern              | Choice                                                                                 | Why                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repo                 | pnpm workspaces + Turborepo monorepo                                                   | Shared types/game logic between client & server; one CI                                          |
| Client               | React 18 + Vite + TypeScript                                                           | Mature ecosystem, fast dev loop                                                                  |
| Client state/routing | TanStack Router + TanStack Query + Zustand                                             | Query for HTTP data, Zustand for socket-driven game state                                        |
| Styling              | Tailwind CSS v4 + custom design tokens                                                 | Speed, plus a real token system for the card design language                                     |
| Animation            | Motion (framer-motion)                                                                 | Card flips, deals, reveals are core to the feel                                                  |
| Server               | Node.js + Fastify (HTTP) + Socket.IO (realtime)                                        | Turn-based games don't need a tick engine; Socket.IO gives rooms, reconnection, fallbacks        |
| Game logic           | Pure TypeScript package, deterministic state machine, event-sourced                    | Runs on server (authoritative) and client (optimistic UI); replayable; unit-testable without I/O |
| Validation           | Zod schemas in a shared package                                                        | One source of truth for socket messages, API payloads, card data                                 |
| Database             | Postgres (Neon free tier) + Drizzle ORM                                                | Relational fits users/matches/stats; Drizzle is light and typed                                  |
| Room state           | In-memory on one server instance (v1); Upstash Redis adapter when we scale out         | Don't pay distributed-systems tax before we have users                                           |
| Auth                 | better-auth: guest sessions + Google OAuth, guest→account upgrade                      | Games need zero-friction entry; upgrade path preserves stats                                     |
| Card data            | Versioned JSON "editions" in-repo, Zod-validated, refreshed by scheduled GitHub Action | Semi-real, auditable via git history, no API costs                                               |
| Web hosting          | Cloudflare Pages or Vercel (static SPA)                                                | Free, fast CDN                                                                                   |
| Server hosting       | Fly.io (or Railway) single small VM                                                    | Long-lived WebSocket connections — serverless is the wrong shape                                 |
| CI/CD                | GitHub Actions                                                                         | Lint, typecheck, test, deploy on merge                                                           |
| Errors               | Sentry (client + server)                                                               | Free tier, session replay on crashes                                                             |
| Logs                 | pino structured logs → Better Stack / Axiom                                            | Searchable live logs on free tier                                                                |
| Live ops             | Custom admin dashboard: live rooms, state inspector, event-log replay                  | Debugging a live game = replaying its event log                                                  |
| Testing              | Vitest (engine, server), bot-vs-bot simulations, Playwright (e2e)                      | Determinism makes the engine exhaustively testable                                               |

---

## Phase 0 — Foundations & tooling

**Responsibility: a monorepo where every later phase has a home, with quality gates from day one.**

Deliverables:

- pnpm + Turborepo monorepo: `apps/web`, `apps/server`, `packages/engine`, `packages/shared` (Zod schemas, types, constants), `packages/ui` (design system + card renderer), `packages/data` (card dataset + pipeline)
- TypeScript strict mode, single root tsconfig with project references
- ESLint + Prettier, husky pre-commit (lint-staged)
- Vitest wired at the root; one smoke test per package
- GitHub Actions CI: install → lint → typecheck → test on every PR
- `README.md` with local dev instructions; `.env.example` files
- GitHub repo settings: branch protection on `main`, PR template, issue labels per phase

Tasks (issue-sized):

1. Scaffold monorepo with pnpm workspaces + Turborepo
2. Configure TypeScript strict + project references across packages
3. Set up ESLint/Prettier/husky
4. Set up Vitest + first smoke tests
5. GitHub Actions CI pipeline
6. Repo hygiene: PR template, labels, branch protection, README

---

## Phase 1 — Game engine (classic trumps)

**Responsibility: the rules of the game as a pure, deterministic, replayable library. No UI, no network, no database.**

Design: the engine is a state machine — `applyCommand(state, command) → events[]`, `reduce(state, event) → state`. All randomness (shuffles, deals) flows from a seeded RNG stored in the initial event, so any game can be replayed exactly from its event log. This one decision powers testing, reconnection, spectating, replays, and live debugging.

Game 1 — Classic Trumps (2–6 players):

- Deck is dealt evenly; turn holder picks a stat (batting avg, strike rate, wickets, economy…); everyone reveals; best value takes the cards; winner leads next round; last player with cards wins
- Rules to pin down in a written spec: tie handling (pot carries over), stat directionality (economy = lower wins), turn timers with auto-play, forfeit/leave handling

Deliverables:

- `packages/engine`: core types (GameState, Command, Event), reducer, command validators, win detection
- Seeded RNG + full replay-from-log function
- Rule spec document (`docs/games/classic-trumps.md`) written before code
- A baseline bot (plays its best stat) — used for tests, filling rooms, and future "play vs computer"
- Test suite: unit tests per rule + property tests (e.g. "cards are conserved across any command sequence") + 1,000-game bot-vs-bot simulation that asserts every game terminates

Tasks:

1. Write Classic Trumps rule spec (tie/timer/forfeit edge cases decided on paper)
2. Engine core: state, commands, events, reducer skeleton
3. Seeded RNG + shuffle/deal + replay function
4. Implement Classic Trumps rules + win conditions
5. Baseline bot player
6. Property tests + mass simulation harness

---

## Phase 2 — Card data & content pipeline

**Responsibility: what's on the cards — the dataset, its schema, and the scheduled refresh.**

Design: cards live in versioned **editions** (e.g. `edition-2026-q3`). An edition is a set of JSON files in `packages/data` — players, teams, and stat definitions — validated by Zod in CI. A game is always played on one pinned edition, so a mid-game data refresh never corrupts running games.

- Player card: name, role (batter/bowler/all-rounder/keeper), team, nationality, rarity tier (legend/star/regular), and 6–7 comparable stats
- Stat definitions carry metadata the engine and UI both read: display name, direction (higher/lower wins), format, min/max for bar rendering
- **Scheduled updates**: a GitHub Action cron (weekly) runs a script that adjusts "form" and ratings — plausible drift with some randomness, not real feeds. It opens a PR with the new edition so every change is reviewed and diffable. Balance report (stat distributions, "is any card strictly dominant?") runs as part of the check.
- Likeness caution: semi-real players are fine to start, but keep the data layer abstract enough that swapping to fictional names is a data change, not a code change

Deliverables:

- Zod schemas for player/team/stat/edition in `packages/shared`
- Seed edition: ~64 players across ~8 teams, hand-curated
- CI validation + balance-report script
- `update-edition` script + weekly GitHub Action cron that opens a PR
- Simple admin CLI: add/edit player, bump rarity, regenerate derived ratings

Tasks:

1. Design card/stat/edition schemas (with engine + UI needs in the review)
2. Curate seed edition (64 players, 8 teams)
3. CI edition validation + balance report
4. Edition update script (form drift heuristics)
5. Weekly cron GitHub Action → PR
6. Admin CLI for dataset edits

---

## Phase 3 — Design system & card design

**Responsibility: how the game looks — above all, how a card looks. This is the product's identity.**

Design direction (to iterate on): cards as premium physical objects — team-colored frames, foil/gradient treatments by rarity, big legible stat table (stats are gameplay, not decoration), portrait silhouette or stylized illustration (no photo likenesses), holographic sheen on legends via CSS gradients + subtle motion.

Deliverables:

- Design tokens in `packages/ui`: palette (per-team colors + neutral system), type scale, spacing, radii, elevation, rarity treatments — light & dark theme
- `<TrumpCard>` renderer: React + SVG, fully data-driven from the edition schema; sizes (hand thumbnail → full reveal); states (face-down, selectable, selected stat highlight, winner/loser)
- Card back design (the brand mark of the game)
- Motion library: deal, flip, stat-select pulse, win-sweep animations (reduced-motion respected)
- Core UI kit: buttons, dialogs, toasts, avatars, room-code display, timer ring
- Card image export (satori or canvas) for share images / og-images later
- A `/cards` gallery route (dev-only at first) showing every card in every state — doubles as visual regression surface

Tasks:

1. Design tokens + theming foundation
2. TrumpCard component (all sizes/states) + card back
3. Rarity treatments (regular/star/legend)
4. Motion set for core game moments
5. Base UI kit components
6. Card gallery page + visual regression screenshots (Playwright)
7. Card image export pipeline

---

## Phase 4 — Realtime server & rooms

**Responsibility: multiplayer plumbing — rooms, connections, and the authoritative game loop.**

Design: Fastify app hosting Socket.IO. The server owns truth: clients send commands, the server validates via the engine, applies them, and broadcasts events. Each client gets a **redacted view** (you never receive other players' hands — anti-cheat by construction). Every game's event log is appended to Postgres, so any game can be reconstructed.

Room lifecycle: create → 6-char join code → lobby (ready checks, host settings: game mode, deck edition, timer length, points) → in-game → results → rematch. Disconnection: 60s grace with auto-play on timer expiry; reconnect replays the redacted event log to rebuild client state. Spectator role joins read-only.

Deliverables:

- Socket protocol defined as Zod schemas in `packages/shared` (client↔server messages, versioned)
- Room manager (in-memory registry, capacity limits, idle-room reaping)
- Auth handshake on socket connect (session token from Phase 6; anonymous guest allowed pre-Phase-6)
- Turn timers server-side with auto-play
- Reconnection flow + spectator mode
- Room chat + emote quick-reactions (rate-limited)
- Event-log persistence (Postgres) + match result records
- Rate limiting and payload-size guards on all inbound messages
- Load smoke test: 50 concurrent bot rooms on one instance

Tasks:

1. Fastify + Socket.IO server skeleton with typed, Zod-validated protocol
2. Room manager + join codes + lobby flow
3. Authoritative game loop bridging Socket.IO ↔ engine, with per-player redaction
4. Server-side turn timers + auto-play
5. Disconnect grace / reconnection / spectators
6. Chat + reactions with rate limiting
7. Event log + match persistence (Drizzle schema + migrations)
8. Bot-driven load smoke test

---

## Phase 5 — Web client & gameplay UI

**Responsibility: the player-facing app — from landing page to playing a full game.**

Screens: Landing (play as guest, create/join room) → Lobby (players, ready states, host settings, invite link/QR) → Game table (your hand, opponents as avatars + card counts, stat selection on your card, simultaneous reveal moment, pot display, timer ring) → Results (winner, fun stats, rematch). The reveal is _the_ moment of the game — it gets the animation budget.

Client architecture: Zustand store fed by socket events; optimistic UI for your own commands with rollback on server rejection; TanStack Query for HTTP data (profile, history); mobile-first layout (people will play on phones), landscape-friendly table.

Deliverables:

- All screens above wired to the live server
- Connection status UX (reconnecting banner, "host left" handling)
- Sound design pass (deal, flip, win, lose — mutable)
- Error and empty states throughout
- Playwright e2e: two headless browsers play a full game against each other

Tasks:

1. App shell, routing, socket client with typed protocol + Zustand game store
2. Landing + create/join flow (join via code and via link)
3. Lobby screen with settings + invite link/QR
4. Game table layout (mobile-first) with hand + opponents
5. Stat-selection and reveal sequence with full animation treatment
6. Results + rematch flow
7. Reconnect/edge-case UX polish
8. Sounds + mute control
9. Playwright full-game e2e

---

## Phase 6 — Auth, profiles & persistence

**Responsibility: identity — who you are across games and devices.**

Design: guests get a persistent anonymous identity (cookie-backed) with a generated cricket-flavored handle, so friends can play in 10 seconds with zero signup. Sign-in (Google OAuth via better-auth, email magic-link as fallback) **upgrades** the guest in place — match history and stats carry over.

Deliverables:

- better-auth integration on Fastify + session validation on socket handshake
- Guest identity + guest→account upgrade path
- Profile: display name, avatar (pick from card-art-style avatar set), stats (games, wins, favourite stat)
- Match history page (backed by Phase 4's match records)
- Account deletion + basic privacy page (we store minimal PII: email + display name)
- Drizzle schemas: users, sessions, matches, match_players

Tasks:

1. better-auth setup: Google OAuth + magic link + guest sessions
2. Socket handshake auth + server-side identity plumbing
3. Guest→account upgrade flow
4. Profile page + avatar picker
5. Match history UI
6. Account deletion + privacy page

---

## Phase 7 — Deployment & CI/CD

**Responsibility: getting it on the internet, repeatably, on hobby budget (~$0–10/month).**

Topology: SPA on Cloudflare Pages → `app.<domain>`; Fastify+Socket.IO on one Fly.io machine → `api.<domain>` (WebSockets need a long-lived process; keep it to **one instance** until Phase 10's Redis adapter — sticky-session problems don't exist with one machine); Neon Postgres; secrets in Fly/GitHub secrets.

Deliverables:

- Dockerfile for server; Fly.io app with health checks (`/healthz` verifying DB connectivity) and auto-restart
- Staging + production environments (two Fly apps, two Neon branches — Neon's branching makes this free)
- GitHub Actions deploy: merge to `main` → staging; tagged release → production; Drizzle migrations run as a release step
- Preview deploys for the web app on every PR
- Domain + TLS + CORS/websocket origin allowlist
- Deploy runbook in `docs/runbook.md` (deploy, rollback, migration failure recovery)

Tasks:

1. Dockerize server + Fly.io setup with health checks
2. Neon setup + migration pipeline in CI
3. Staging/production split + promote-on-tag workflow
4. Cloudflare Pages + PR preview deploys
5. Domain, TLS, CORS/origin hardening
6. Runbook: deploy, rollback, incident basics

---

## Phase 8 — Observability & live ops

**Responsibility: seeing what's happening in production — monitoring current games and debugging live issues.**

Design: three layers. (1) **Telemetry**: Sentry both sides (release-tagged, source maps), pino structured logs shipped to Better Stack/Axiom, every log line carrying `roomId`/`matchId`/`userId`. (2) **Metrics**: lightweight server counters (active rooms, connected sockets, games started/completed, avg game length, error rates) exposed on an internal endpoint and graphed. (3) **Admin dashboard** (`/admin`, role-gated): live room list with player counts and game phase; click into a room → current state inspector (server truth) + live event feed; **replay debugger** — load any finished/broken game's event log and step through it event by event with the actual game UI. Because the engine is deterministic and event-sourced, "debugging a live game" = replaying its log. Plus moderation controls: close room, kick player, broadcast maintenance banner.

Deliverables:

- Sentry wired client+server with releases + source maps
- Structured logging with correlation IDs end-to-end
- Metrics endpoint + uptime monitoring (Better Stack heartbeat on `/healthz`) + alerting to email/Slack
- Admin dashboard: live rooms, state inspector, event feed
- Replay debugger (step through any match's event log in the UI)
- Moderation tools: kick, close room, maintenance banner
- Feature flags via a simple DB-backed config (kill-switch per game mode)

Tasks:

1. Sentry client+server with releases/source maps
2. pino structured logs + log drain + correlation IDs
3. Metrics counters + uptime checks + alerts
4. Admin auth/role + live rooms dashboard
5. Room state inspector + live event feed
6. Replay debugger
7. Moderation actions + maintenance banner + game-mode kill switches

---

## Phase 9 — Second game mode & game-mode framework

**Responsibility: proving the platform is multi-game — extract the framework, ship a strategy mode.**

Design: formalize what a "game mode" is — a `GameMode` interface in the engine (setup, commands, reducer, redaction, bot, UI descriptor) so modes plug into rooms/server/lobby without touching plumbing. Then build **Squad Draft** (working title), a genuinely strategic mode: players draft cards from a shared pool over rounds (snake draft), build an XI under constraints (max overseas, need a keeper, role balance), then score head-to-head across simulated match phases where card stats + role synergies decide outcomes. Draft = real decisions; constraints = tradeoffs; scoring = tension.

Deliverables:

- `GameMode` plugin interface + Classic Trumps refactored onto it
- Squad Draft rule spec → engine implementation → bot → tests (same rigor as Phase 1)
- Draft UI (shared pool, pick timer, roster building) + match-phase reveal UI
- Mode selection in lobby, per-mode kill switch, per-mode stats
- A third mode designed on paper only (backlog validation of the interface)

Tasks:

1. Extract GameMode interface, port Classic Trumps
2. Squad Draft rule spec
3. Squad Draft engine + bot + simulation tests
4. Draft UI + roster builder
5. Match-phase scoring UI
6. Lobby mode selection + per-mode plumbing
7. Paper design for mode #3

---

## Phase 10 — Polish, growth & scale readiness

**Responsibility: retention, sharing, and removing the single-instance ceiling.**

Deliverables (prioritized backlog, not all-or-nothing):

- Ranked play: ELO/Glicko rating per mode, seasonal leaderboards (seasons align with data editions)
- Public rooms / quick-match queue with bot backfill after a wait threshold
- Friends & recent players; invite links with og-image card previews (Phase 3's card export)
- Match replays shareable by link (replay debugger, player-facing skin)
- Collection meta: track cards you've won matches with, showcase favourite card on profile
- PWA install + offline "vs bot" practice mode
- Scale-out when needed: Upstash Redis Socket.IO adapter + room-state externalization, second Fly instance, sticky sessions
- Cost/abuse review: quotas per user, room caps, CAPTCHA on abuse signals

Tasks:

1. Rating system + leaderboards
2. Quick match + bot backfill
3. Friends/recent players + rich invite links
4. Shareable replays
5. Collection/showcase meta
6. PWA + offline practice
7. Redis adapter + multi-instance readiness
8. Abuse/quota hardening

---

## Cross-cutting practices (every phase)

- **Spec before code** for game rules — edge cases decided in a doc, not in a reducer
- **Shared Zod schemas** are the contract; no untyped socket messages ever
- **Determinism is sacred** — no `Math.random()` or `Date.now()` inside the engine; everything via injected seed/clock
- **Definition of done**: tests + docs updated + works on mobile + dark mode
- Keep a `docs/decisions/` ADR folder — one page per irreversible choice

## Suggested sequencing & parallelism

Phases 0→1→2 are sequential-ish (engine needs foundations; data schema informs engine stats). Phase 3 (design) can run **in parallel** with 1–2 since the card renderer only needs the data schema. Phases 4→5 build on 1–3. Phase 6 can overlap late Phase 5. Phase 7 should actually start early in skeleton form (deploy a hello-world in week 1) and be completed properly after 5. Phase 8 lands before inviting real users. 9 and 10 are post-launch.

**Milestone A (playable prototype):** end of Phase 5 — friends can play Classic Trumps in a room via a link.
**Milestone B (public soft launch):** end of Phase 8 — auth, deployed, observable.
**Milestone C (real game platform):** end of Phase 9 — two modes on a plugin framework.
