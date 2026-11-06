# Oiko web app (Next.js) for local mode.
FROM node:22-bookworm-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CI=1
# Manifests first so dependency installs are cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY examples/agents/scripted/package.json examples/agents/scripted/package.json
COPY examples/agents/telegram-bot/package.json examples/agents/telegram-bot/package.json
RUN pnpm install --frozen-lockfile --filter "@oiko/web..." --filter "@oiko/example-agent"
COPY . .
RUN pnpm --filter @oiko/web build
COPY docker/web-start.sh /usr/local/bin/web-start
EXPOSE 3000
CMD ["sh", "/usr/local/bin/web-start"]
