#!/usr/bin/env node
// Zero-config local mode without Docker: NEAR sandbox + every Oiko contract + the web app on http://localhost:3000.
//   pnpm local              build the web app, then serve it with `next start`
//   pnpm local --dev        serve with `next dev` instead (hot reload)
//   pnpm local --no-build   reuse the last `next build`
//   pnpm local --chain-only start only the devnet (e.g. to run `pnpm dev` yourself)
// Needs: Rust (contracts/rust-toolchain.toml), cargo-near (only if contracts/res/*.wasm are missing), Node 22, pnpm.
// Settings written by the devnet (.oiko/local.env, .oiko/relayer.json) override any testnet values in apps/web/.env.local.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, ".oiko");
const args = new Set(process.argv.slice(2));
const PORT = process.env.PORT ?? "3000";
const children = [];
const log = (s) => console.log(`[local] ${s}`);

function stopAll(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function run(cmd, argv, opts = {}) {
  const c = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(c);
  return c;
}

/** A near-sandbox binary that an earlier contract build already downloaded (saves a ~90 MB download). */
function existingSandboxBin() {
  if (process.env.NEAR_SANDBOX_BIN_PATH) return process.env.NEAR_SANDBOX_BIN_PATH;
  for (const profile of ["release", "debug"]) {
    const build = join(ROOT, "contracts/target", profile, "build");
    if (!existsSync(build)) continue;
    for (const d of readdirSync(build).filter((d) => d.startsWith("near-sandbox-"))) {
      const near = join(build, d, "out/.near");
      if (!existsSync(near)) continue;
      for (const v of readdirSync(near)) {
        const bin = join(near, v, "near-sandbox");
        if (existsSync(bin)) return bin;
      }
    }
  }
  return undefined;
}

async function startChain() {
  log("starting the NEAR sandbox and deploying contracts (first run compiles the launcher; a few minutes)…");
  const c = run("cargo", ["run", "--quiet", "--release", "-p", "oiko-tests", "--bin", "devnet"], { cwd: join(ROOT, "contracts"), env: { ...process.env, ...(existingSandboxBin() ? { NEAR_SANDBOX_BIN_PATH: existingSandboxBin() } : {}) } });
  await new Promise((resolve, reject) => {
    const onLine = (buf) => {
      const s = buf.toString();
      process.stdout.write(s.replace(/^/gm, "[chain] "));
      if (s.includes("oiko devnet ready")) resolve();
    };
    c.stdout.on("data", onLine);
    c.stderr.on("data", (b) => process.stderr.write(b.toString().replace(/^/gm, "[chain] ")));
    c.on("exit", (code) => reject(new Error(`devnet exited (${code})`)));
  });
  c.on("exit", (code) => { log(`devnet stopped (${code})`); stopAll(1); });
}

function localEnv() {
  const env = {};
  for (const line of readFileSync(join(STATE, "local.env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  const k = JSON.parse(readFileSync(join(STATE, "relayer.json"), "utf8"));
  return {
    ...env,
    RELAYER_ACCOUNT_ID: k.account_id, RELAYER_PRIVATE_KEY: k.private_key,
    OIKO_PUBLIC_URL: `http://localhost:${PORT}`, OIKO_PUBLIC_NODE_URL: env.OIKO_NODE_URL,
    OIKO_VAULT_FUNDING_NEAR: "0.3", ONECLICK_BASE_URL: "mock", DATABASE_URL: "", CRON_SECRET: "",
    FEATURE_EARN: "true", FEATURE_AJO: "true", FEATURE_MCP: "true",
  };
}

async function waitHttp(url, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not come up`);
}

async function main() {
  await startChain();
  if (args.has("--chain-only")) { log("devnet running; Ctrl-C to stop"); return; }
  const env = { ...process.env, ...localEnv(), PORT };
  const dev = args.has("--dev");
  if (!dev && (!args.has("--no-build") || !existsSync(join(ROOT, "apps/web/.next/BUILD_ID")))) {
    log("building the web app (next build)…");
    const b = spawnSync("pnpm", ["--filter", "@oiko/web", "build"], { cwd: ROOT, env, stdio: "inherit" });
    if (b.status !== 0) { log("web build failed"); stopAll(1); return; }
  }
  const web = run("pnpm", ["--filter", "@oiko/web", dev ? "dev" : "start", "-p", PORT], { cwd: ROOT, env });
  web.stdout.on("data", (b) => process.stdout.write(b.toString().replace(/^/gm, "[web] ")));
  web.stderr.on("data", (b) => process.stderr.write(b.toString().replace(/^/gm, "[web] ")));
  web.on("exit", (code) => { log(`web stopped (${code})`); stopAll(code ?? 1); });
  await waitHttp(`http://localhost:${PORT}/api/config`);
  console.log(`\noiko ready at http://localhost:${PORT}\n`);
}

main().catch((e) => { console.error(`[local] ${e.message}`); stopAll(1); });
