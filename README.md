# DeckXI

An online multiplayer card game platform built around cricket trump cards. Players create rooms,
friends join with a code, and they play trump-card games — starting with classic stat-comparison
trumps and growing into deeper strategy modes.

See [PLAN.md](./PLAN.md) for the full build plan and architecture.

## Repository layout

| Path              | Package          | What lives here                                          |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `apps/web`        | `@deckxi/web`    | React SPA (Vite) — the player-facing app                 |
| `apps/server`     | `@deckxi/server` | Fastify + Socket.IO realtime game server (authoritative) |
| `packages/engine` | `@deckxi/engine` | Pure, deterministic, event-sourced game engine           |
| `packages/shared` | `@deckxi/shared` | Zod schemas, types and constants shared everywhere       |
| `packages/ui`     | `@deckxi/ui`     | Design system, tokens and the TrumpCard renderer         |
| `packages/data`   | `@deckxi/data`   | Versioned card editions and the content pipeline         |

## Prerequisites

- Node.js >= 22
- pnpm 11 (`corepack enable` will pick up the pinned version from `package.json`)

## Local development

```sh
pnpm install        # install all workspace dependencies
pnpm dev            # run dev tasks across the workspace (via Turborepo)
pnpm build          # build every package (respects dependency graph)
```

### Quality gates

```sh
pnpm lint           # ESLint across the repo
pnpm format         # Prettier write
pnpm format:check   # Prettier check (CI mode)
pnpm typecheck      # tsc -b over all project references
pnpm test           # Vitest across all packages
```

All of these run in CI on every push/PR, and a husky pre-commit hook runs lint-staged on staged
files.

### Card data pipeline

Card data lives in versioned editions (`packages/data/editions/*.json`), Zod-validated in CI. The
shipped edition is real: 210 men's T20 International careers derived from
[Cricsheet](https://cricsheet.org/) ball-by-ball data, with names from Wikidata and licensed photos
from Wikimedia Commons — see [`docs/data-sources.md`](docs/data-sources.md) for the licences and
the derivation rules. `edition-fixture` is the fictional deck the visual-regression suites render.

```sh
pnpm --filter @deckxi/data check                     # schema validation + balance report
pnpm --filter @deckxi/data import-cricsheet --photos # rebuild the shipped edition from source (Monday cron → PR)
pnpm --filter @deckxi/data update-edition --edition edition-fixture  # synthetic form drift (fixture only)
pnpm --filter @deckxi/data cli list                  # admin CLI: list/show/set-stat/set-rarity/add-player/…
```

### Environment variables

Each app has a `.env.example` documenting the variables it needs. Copy it to `.env` and fill in
values — `.env` files are gitignored and must never be committed.

```sh
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

## Deployment

The SPA runs on Cloudflare Pages, the API on a single Cloud Run instance, backed by Neon Postgres —
every piece on a free tier. Merging to `main` deploys staging; production isn't provisioned until
launch. Migrations run as a separate job before the new image goes live.

```sh
docker build -t deckxi-server . && docker run -p 3001:3001 deckxi-server  # build the API image locally
```

See [`docs/runbook.md`](docs/runbook.md) for setup, deploys, rollback and incident basics.

## Contributing

- Work happens on branches; `main` is protected and changes land via PR with green CI.
- Issues are labeled per phase (`phase-0` … `phase-10`); each phase has an `epic` issue tracking
  its tasks.
- Game-rule changes require a spec update in `docs/` before code.
