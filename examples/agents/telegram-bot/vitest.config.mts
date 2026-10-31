import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "telegram-bot", environment: "node", include: ["src/**/*.test.ts"] } });
