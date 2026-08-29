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

Card data lives in versioned editions (`packages/data/editions/*.json`), Zod-validated in CI.

```sh
pnpm --filter @deckxi/data check           # schema validation + balance report
pnpm --filter @deckxi/data update-edition  # apply weekly form drift (also runs on a Monday cron → PR)
pnpm --filter @deckxi/data cli list        # admin CLI: list/show/set-stat/set-rarity/add-player/…
```

### Environment variables

Each app has a `.env.example` documenting the variables it needs. Copy it to `.env` and fill in
values — `.env` files are gitignored and must never be committed.

```sh
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

## Contributing

- Work happens on branches; `main` is protected and changes land via PR with green CI.
- Issues are labeled per phase (`phase-0` … `phase-10`); each phase has an `epic` issue tracking
  its tasks.
- Game-rule changes require a spec update in `docs/` before code.
