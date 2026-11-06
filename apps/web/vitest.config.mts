import { defineConfig } from "vitest/config";
// Server modules only (UI tests, if any, belong in their own project config).
export default defineConfig({ test: { name: "web-server", environment: "node", include: ["server/**/*.test.ts", "lib/**/*.test.ts"] } });
