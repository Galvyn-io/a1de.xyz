FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY packages/supabase/package.json packages/supabase/
RUN pnpm install --frozen-lockfile
COPY backend/ backend/
COPY packages/supabase/ packages/supabase/
RUN pnpm --filter @a1de/backend build

FROM base AS runtime
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY packages/supabase/package.json packages/supabase/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/backend/dist backend/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
