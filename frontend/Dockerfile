FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY frontend frontend
COPY packages packages
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @tutor-walle/web build

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 10001 tutorwalle && useradd --system --uid 10001 --gid tutorwalle --home-dir /app tutorwalle
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/frontend/.next/standalone ./
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/frontend/.next/static ./frontend/.next/static
USER tutorwalle
EXPOSE 3000
CMD ["node", "frontend/server.js"]

