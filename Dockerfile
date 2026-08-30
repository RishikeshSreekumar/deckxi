# Server image. Built from the monorepo root so workspace packages resolve.
#   docker build -t deckxi-server .
#   docker run -p 3001:3001 deckxi-server
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Manifests only: this layer is cached until a package.json or the lockfile
# changes, so source edits don't re-download the dependency tree.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/data/package.json packages/data/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

# Runtime dependency tree: server + its workspace dependencies, prod only.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@deckxi/server..."

# Full install + TypeScript build (tsc -b builds the referenced packages too).
FROM manifests AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/server apps/server
RUN pnpm --filter @deckxi/server build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
# node_modules (with its workspace symlinks) laid out at the same paths.
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/data/dist packages/data/dist
COPY --from=build /app/packages/data/editions packages/data/editions
COPY --from=build /app/apps/server/dist apps/server/dist
# Migrations ship with the image so a machine can be used to run them by hand.
COPY apps/server/drizzle apps/server/drizzle
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
