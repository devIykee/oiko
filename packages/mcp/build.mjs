// Bundles the stdio CLI (including @oiko/sdk source) into dist/cli.mjs; third-party deps stay external.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
await build({
  entryPoints: ["src/cli.ts"], outfile: "dist/cli.mjs", bundle: true, platform: "node", format: "esm", target: "node20",
  external: Object.keys(pkg.dependencies).filter((d) => d !== "@oiko/sdk"),
  banner: { js: "// oiko-mcp — built file" },
});
console.log("built dist/cli.mjs");
