import { defineConfig } from "vitest/config";

// `pnpm test:unit` runs every workspace project. A project folder may add its own vitest.config.ts (e.g. jsdom for UI).
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web", "examples/agents/telegram-bot"],
  },
});
