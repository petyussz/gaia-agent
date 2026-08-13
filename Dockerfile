# ── build ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# Dependency layer — cached until the package files themselves change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.ts tsconfig.json ./
COPY src/ ./src/

# `npm run build` is `tsc --noEmit && vite build`, so a type error fails the image build.
# Vite alone would happily emit a broken bundle.
RUN npm run build

# Leaves only production dependencies for the runtime stage to copy.
RUN npm prune --omit=dev

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    GAIA_DATA_DIR=/app/data \
    GAIA_SYSTEM_PROMPT_PATH=/app/system_prompt.md

# tsx lives in `dependencies`, not `devDependencies` — the prune above would otherwise remove
# the very thing that runs server.ts.
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/dist ./dist/

COPY package.json server.ts ./
COPY src/server/ ./src/server/
COPY src/shared/ ./src/shared/

# Baked in so the container runs without a mount; docker-compose bind-mounts over it read-only
# so the operator can edit the persona on the host.
COPY system_prompt.md ./

# Owned by `node` because the container runs unprivileged and the session store is written here.
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 8788

# Targets a public endpoint on purpose: /api/health sits behind the access token, so with
# GAIA_ACCESS_TOKEN set it would answer 401 and the container would look permanently unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node_modules/.bin/tsx", "server.ts"]
