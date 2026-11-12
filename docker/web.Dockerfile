# Oiko web app (Next.js) for local mode.
FROM node:22-bookworm-slim
# apt: retries + IPv4 so a DNS blip reaching the package mirrors does not fail the build (CI flake).
RUN corepack enable \
 && printf 'Acquire::Retries "5";\nAcquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/80-ci-retries \
 && for i in 1 2 3 4 5; do \
      (apt-get update && apt-get install -y --no-install-recommends curl ca-certificates) && break; \
      [ "$i" = 5 ] && exit 1; echo "apt attempt $i failed, retrying"; sleep $((i * 10)); \
    done \
 && rm -rf /var/lib/apt/lists/*
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
