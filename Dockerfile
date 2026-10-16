FROM node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY backend backend
COPY packages packages
RUN pnpm --filter @tutor-walle/api build
RUN pnpm --filter @tutor-walle/api --prod deploy --config.inject-workspace-packages=true /prod/api
RUN cd /prod/api && ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma

FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime-base
# Prisma's Debian OpenSSL 3 query engine needs these two runtime libraries.
# Copy only those libraries and the CA bundle from the full builder image.
COPY --from=build /usr/lib/*/libssl.so.3 /usr/lib/
COPY --from=build /usr/lib/*/libcrypto.so.3 /usr/lib/
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN ldconfig

FROM runtime-base AS egress
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 tutorwalle \
    && useradd --system --uid 10001 --gid tutorwalle --home-dir /app tutorwalle
COPY --from=build --chown=tutorwalle:tutorwalle /prod/api/node_modules ./node_modules
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/backend/dist ./dist
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/backend/package.json ./package.json
USER tutorwalle
EXPOSE 3128 5432
CMD ["node", "dist/egress-gateway.js"]

FROM runtime-base AS api
ENV NODE_ENV=production
# Local-disk uploads land here (config default resolves against cwd=/app).
ENV UPLOAD_DIR=/app/uploads
WORKDIR /app
RUN groupadd --system --gid 10001 tutorwalle \
    && useradd --system --uid 10001 --gid tutorwalle --home-dir /app tutorwalle
COPY --from=build --chown=tutorwalle:tutorwalle /prod/api/node_modules ./node_modules
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/backend/dist ./dist
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/backend/prisma ./prisma
COPY --from=build --chown=tutorwalle:tutorwalle /workspace/backend/package.json ./package.json
RUN mkdir -p /app/uploads && chown tutorwalle:tutorwalle /app/uploads
USER tutorwalle
EXPOSE 3001
CMD ["node", "dist/server.js"]
