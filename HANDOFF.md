# Oiko handoff

Written 2026-11-06 for the next coding agent. Read this whole file before touching anything. Then read, in this order:
- `docs/BUILD_PROMPT.md`: the product spec, plus founder follow-ups at the bottom that override it.
- `docs/STATUS.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`: verified external facts and every deviation from the spec.
- `docs/interfaces/*.md`: contract, HTTP and SDK interfaces.
- `apps/web/AGENTS.md`: Next.js 16 differs from your training data; read `node_modules/next/dist/docs/` when unsure.

Hackathon: NEAR HACKATHON. **Deadline 2026-11-14 23:59 UTC**, judging 16–18 Nov. Screening is done first by Claude Code and Codex, which check that the README runs and does what it says. Every README claim must be reproducible by a command.

---

## 0. Who, what, where

| Thing | Value |
|---|---|
| Product | **Oiko**: a personal finance app on NEAR stablecoins (USDC, USDT). Tagline: **"Personal finance meets personal intelligence."** No built-in AI: users connect their own agent, which works within limits the account contract enforces. |
| Founder | GitHub `devIykee`; npm `deviykee`; contact `eokorie1944@gmail.com`. They want it to read as a real global product, not a hackathon project. |
| Repo | `github.com/devIykee/oiko`, **private**. The founder makes it public before submitting, after confirming the Acorn font licence. Branch `main`. |
| Hosting | Vercel project `oiko` (team `iykes-projects-dc0db0ed`), root dir `apps/web`, Node 22, linked to GitHub. **Every push to `main` auto-deploys to production.** |
| Live URL | **https://oikodotnear.vercel.app** (canonical). `oiko-lemon.vercel.app` redirects there. |
| Database | Neon Postgres via the Vercel integration (`DATABASE_URL` set in Vercel). Tables are created on first use (`apps/web/server/db/schema.ts`, `CREATE TABLE IF NOT EXISTS`). Local port 5432 is blocked on the founder's network, so verify DB behaviour through the deployed API. |
| npm | **`oiko-mcp`** v0.1.0, published by the founder. The `@oiko` scope belongs to a different npm user, so never use `@oiko/mcp`. Publishing needs the founder in their own terminal; npm 2FA and the auto-mode classifier block publishing from the agent. |
| Network | NEAR **testnet** for everything live. Mainnet is not launching now; `/admin` has a display-only "mainnet framing" switch. |
| Admin | `/admin` (unlinked, noindex). Password is in env `ADMIN_PASSWORD` (Vercel + `apps/web/.env.local`); the founder knows it. **Never write it into any committed file.** |

### Testnet accounts

| Account | Role | Keys |
|---|---|---|
| `oiko.testnet` | Registry (name registry, vault code hash) | **NONE: locked 2026-11-05.** Immutable forever. |
| `ajo.oiko.testnet` | ROSCA savings contract (user-facing name "ROSCA savings", internal name "ajo") | **NONE: locked.** |
| `usdc.oiko.testnet`, `usdt.oiko.testnet` | Mock NEP-141 test tokens, 6 decimals. Minter = relayer. | full-access key in `~/.near-credentials/testnet/` |
| `lending.oiko.testnet` | Mock Rhea/Burrow lending (same method names/JSON). Admin = relayer (`set_state`). | full-access key |
| `oiko-relayer.testnet` | Relayer: pays signups (0.6 NEAR each), top-ups, sync, mints test tokens | full-access key; private key also in Vercel `RELAYER_PRIVATE_KEY` |
| `brightline-fibre.testnet`, `metro-power-co.testnet` | Demo billers ("Brightline Fibre", "Metro Power"), registered on both test tokens, small tx history. Created 2026-11-05, so they pass the 7-day age check from 2026-11-12. | full-access keys in `~/.near-credentials/testnet/` |
| Vault code (global contract) | Current hash **`72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex`** (298,917 bytes). The old hash `3G9Gwhrtq8gN1ugLLNBShdjbw3s1imNH8FVrUXYWTPPR` is still published and used by accounts created before 2026-11-05 (see gotcha G7). | n/a |

Credentials: near-cli-rs legacy keychain at `~/.near-credentials/testnet/<account>.json` (`private_key` field). `apps/web/.env.local` has the testnet env including `RELAYER_PRIVATE_KEY`, `ADMIN_PASSWORD` and `CRON_SECRET`; it is gitignored. The root `.env.local`, from `vercel link`/`vercel integration`, has Neon creds and is gitignored too. **Never commit any of these.** Verify with `git ls-files | grep -iE "env|credential"`, which must show only `.env.example`.

### Testnet NEAR budget (check before anything that spends)

```bash
for a in oiko.testnet oiko-relayer.testnet; do curl -s https://rpc.testnet.near.org -H 'content-type: application/json' \
 -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$a\"}}" \
 | python3 -c "import sys,json;r=json.load(sys.stdin)['result'];print('$a',int(r['amount'])/1e24)"; done
```

- On 2026-11-05 the relayer had about 15.8 + 8.5 NEAR.
- Each signup costs about 0.6 NEAR, and each `pnpm smoke` run costs about 0.2–0.3 NEAR net (it deletes its sign-in account but the keyless vault keeps its funding).
- Getting more: the founder sends from https://near-faucet.io, or, with the founder's explicit OK, `near account create-account sponsor-by-faucet-service <new>.testnet ...` then `near account delete-account <new> beneficiary oiko-relayer.testnet ...` (10 NEAR each). The auto-mode classifier blocks this as bot-like unless the user explicitly asks in chat, so don't loop it.

---

## 1. Architecture (as built)

```
apps/web            Next.js 16 App Router: landing, product app, ALL APIs under /api (relayer, 1Click proxy + mock,
                    agent gateway, MCP over HTTP, counterparty, invoices, receipts, admin, cron).
  server/           plain TS modules, no Next imports (config, relayer, intents, mock1click, gateway, agentHttp, mcp,
                    counterparty*, invoices*, receipts, admin, store (Postgres|memory), db/schema, ratelimit, discovery)
  app/(marketing)   landing (/), /security, /how-it-works, /docs/agents
  app/(app)         product: /home /plan /bills /invoices /pots /pots/[id] /pots/earn /rosca/* /insights /agents
                    /activity /settings /receive /withdraw /move /more /invest(flag)
  app/pay/[name]    sender pay page (uses components/app/PayFlow.tsx)
  app/i/[id]        public invoice page;  app/start  signup;  app/connect  agent consent;  app/admin  admin panel
  lib/              session (passkey PRF / browser key), signup, data hooks, actions (useMoney), i18n (English only), fixtures (?fixture=1, dev only)
  app/stars.css     night-sky dark mode
packages/sdk        @oiko/sdk: types, amounts (bigint), keys, NearRpc (with retries), Signer, VaultClient/RegistryClient/AjoClient,
                    NEP-413, GatewayClient (counterparty-checking wrapper), errors (friendlyError for every E_ code), insights, caps
packages/ui         @oiko/ui: tokens.css (light/dark), styles.css (oi- classes), motion, icons (framework7 glyphs), logos (web3icons), components incl. pot stack
packages/mcp        oiko-mcp: stdio MCP server (bin oiko-mcp); `./internal` export used by apps/web/server/mcp.ts
contracts/          Rust near-sdk 5.29.1, toolchain 1.93.0: common, vault, registry, ajo, mocks/ft, mocks/lending, tools/state-wipe, tests (near-workspaces 0.23)
examples/agents     scripted (no LLM), attack-demo (prompt-injection demo), telegram-bot, claude-desktop.json
scripts/            build-contracts.sh, deploy-testnet.sh, redeploy-testnet.sh, deploy-mainnet.sh, mainnet-proof.ts, near-rpc.py,
                    check-copy.mjs, check-no-llm.mjs, local.mjs (WIP), readme-check.ts (WIP)
docker/, docker-compose.yml, e2e/, playwright.config.ts   local mode + Playwright (WIP, see Phase 1)
brand/              logo (gabled "o"), renders, scripts
```

**Account model**
- `name.oiko.testnet` is the identity account. It holds the owner's full-access key (from a passkey via WebAuthn PRF, or a browser key) and an app function-call key that can call every owner method except `withdraw_large`, `rescue_sign`, `approve_proposal_large` and `add_agent_large`.
- `vault.name.oiko.testnet` holds the money. It has **no keys**, except the agent function-call keys it adds to itself (methods `agent_execute` and `agent_propose` only). It has no upgrade or admin method.
- Funds arrive by `ft_transfer`, and a permissionless, idempotent `sync()` credits them through the user's plan (split rules).

**Agents**
- Agents sign gateway requests with NEP-413 (`Authorization: NEP413 …`). Hosted agents are adding a bearer session (Phase 2).
- Before `act`/`propose` pays anyone, the counterparty check returns allow/warn/block. On-chain caps and the allowlist are the hard guarantee.

**Money in test mode**
- NEAR Intents has no testnet, so `/api/intents/*` uses a built-in mock 1Click (`server/mock1click.ts`) with signed "tickets" so any serverless instance can rebuild a swap.
- "Simulate payment" mints test tokens to the vault via the relayer, then syncs.
- Mainnet code paths call the real `https://1click.chaindefuser.com` (live minimum swap: 100 units).

---

## 2. Rules you must not break

1. **No built-in AI.** `node scripts/check-no-llm.mjs` must pass. No LLM SDKs or LLM API hosts in apps/packages/services.
2. **Copy rules** (`node scripts/check-copy.mjs` must pass):
   - Never "dollar(s)", a standalone "USD", or "$" before a digit. The only allowed exceptions are the stablecoin explainer and two whitelisted honest phrasings.
   - Product screens never use: crypto, web3, blockchain, on-chain, DeFi, wallet, token (as money), vault, gas, network, bridge, RPC, mint, wrap.
   - Combined balances are labelled "**stablecoins**"; the Home total is "**Total stables**" (founder override 2026-11-05). Per-token chips keep USDC/USDT.
   - The feature "ajo" is called "**ROSCA savings**" in all user/agent-facing text; internal identifiers keep `ajo`.
   - **Global, English only.** No naira, no country-specific names or examples (no Lagos, Tunde etc.), no Pidgin.
   - No hackathon branding on the website (README and SUBMISSION may mention it).
3. **Design:**
   - **Fonts** (founder decisions): Acorn for headings, app UI, labels, buttons and amounts; **Chillax** (Fontshare, free licence, self-hosted in `apps/web/fonts`) for supporting text only: grey/muted copy, small print, list subtitles, quoted reasons (`globals.css`, from 2026-11-06). Acorn has no tabular figures, so amounts sit in fixed-width boxes.
   - Revolut-like patterns with Oiko's own brand. Flat colour, no gradients, except the dark-mode star layer, which is founder-requested.
   - Icons: framework7 glyphs, web3icons logos for chains and coins, simple-icons for share brands. No Lucide or emoji.
   - Dark mode = night sky (`apps/web/app/stars.css`), with stars only in the gaps around cards.
4. **No fake numbers.** No hardcoded APY, user counts or TVL.
5. **Never sign mainnet transactions or spend real money without the founder's explicit "yes" in chat.** The mainnet scripts make the human type confirmations.
6. **Never commit secrets** (section 0).
7. **Testnet contracts on `oiko.testnet` and `ajo.oiko.testnet` are locked.** Any contract fix ships as a NEW deployment under a new root (see Phase 5), never as an edit to these.
8. **Commit small, push to `main`, then confirm the Vercel deploy is "Ready" and the live site still works.** Run these before every push:

```bash
pnpm install --frozen-lockfile          # Vercel uses frozen lockfile: if package.json changed, run `pnpm install` and commit pnpm-lock.yaml
node scripts/check-copy.mjs && node scripts/check-no-llm.mjs
(cd apps/web && npx tsc --noEmit -p . 2>&1 | grep -v "^\.next\|^  ")   # ignore generated .next type noise only
pnpm test:unit                          # 157 tests as of 2026-11-06
(cd apps/web && pnpm build)
```

Deploy status: `vercel ls oiko`; build errors: `vercel inspect <deployment-url> --logs`. Vercel keeps serving the last good build if one fails, so a failed deploy is silent on the live site; always check.

---

## 3. Gotchas learned the hard way

- **G1 `pkill -f "next dev -p 3200"` kills your own shell**, because the pattern matches the bash command line. Use a bracket trick: `pkill -f "next dev -p 3[2]00"`.
- **G2 RPC flakiness.** `https://test.rpc.fastnear.com` and `rpc.testnet.near.org` sometimes fail with `fetch failed`/ETIMEDOUT from this WSL machine. `NearRpc` retries 4 times. Rerun before debugging.
- **G3 Prepaid gas is reserved at a pessimistic price on testnet:** about 0.1 NEAR per 100 Tgas. Agent txs use 100 Tgas, and the gateway tops up vaults below 0.15 NEAR. Don't raise agent gas.
- **G4 Mock 1Click double credit** (Grok item 1): status polls and simulate could both mint. Being fixed with an atomic mint claim; verify it (Phase 2).
- **G5 Frozen lockfile.** Changing any `package.json` without committing `pnpm-lock.yaml` makes the Vercel build fail.
- **G6 `oiko-mcp` packaging.** `packages/mcp/build.mjs` bundles `@oiko/sdk` into `dist/cli.mjs` (the SDK is a devDependency). The published files are `dist`, `bin` and README. `./internal` → `src/index.ts` is for the web app only. To release: bump the version, `node build.mjs`, `pnpm pack`, then the founder runs `npm publish ./oiko-mcp-<v>.tgz --access public` in their own terminal (2FA via browser).
- **G7 Old-code accounts.** Accounts registered before 2026-11-05 (e.g. the founder's `iyke.oiko.testnet`) have vaults on the OLD code hash `3G9G…`. They lack `ajo_cancel`/`ajo_leave`/`ajo_remove_member`/`ajo_set_invite`, the `*_large` methods and the security fixes. Their app keys also have the old method list. ROSCA cancel now works for them via `/api/rosca/cancel` once the group is past its forming window (10 min test build, 7 days mainnet build). Recommended: the app detects `global_contract_hash != config.vaultCodeHash` and shows a "This account uses an older version" banner offering to start a fresh name (Phase 2).
- **G8 Registry `suggest` and names.** Only valid NEAR labels are accepted (`E_BAD_NAME`). Names in the old (wiped) registry can't be re-registered if their accounts still exist (the relayer is refunded).
- **G9 The auto-mode classifier blocks:** faucet loops, publishing to npm, adding Vercel integrations and running scripts that spend NEAR, unless the user asked in chat. Ask the founder to run such commands with `! <command>` or in their own terminal.
- **G10 Dev servers.** Turbopack can get stuck reloading if two dev servers share `.next`. `next.config.ts` supports `OIKO_DIST_DIR=.next/ui` for a second server. Kill stray servers when done (G1).
- **G11 Global contract cost.** Publishing the vault burns about 1e20 yocto per byte (about 29.9 NEAR at 299 KB). `scripts/build-contracts.sh` needs `wasm-opt -Oz` (binaryen) to stay under 300 KB.
- **G12 near-workspaces** 0.23 (0.24 needs rustc 1.95). Sandbox tests rebuild the wasm once per test binary; set `OIKO_SKIP_BUILD=1` to skip.
- **G13 NearBlocks free API** allows about 6 calls a minute. The counterparty check caches (24 h age, 10 min counts). When rate-limited, verdicts degrade to warn (agents must propose). Verified billers bypass the age/activity warnings.

---

## 4. Phases (do them in order; each ends with commit + push + live check)

### Phase 1: Finish the Grok demo-report fixes (highest priority; the founder wants to reshoot the demo)

The founder demoed with a Grok agent and reported 17 issues; the full text is in the conversation and summarised below. The UI agent was partway through when it stopped: items 1, 3, 5, 6 and part of 14 appear implemented (receipts with fees `server/receipts.ts`, shared caps `packages/sdk/src/caps.ts`, access log detail and tests in `server/__tests__/accessLog.test.ts`, `receipts.test.ts`, `caps.test.ts`). It stopped at item 9. **Verify each item below on the live site with a fresh account; don't trust this note.**

| # | Item | Done when |
|---|---|---|
| 1 | One "Simulate payment" click must credit ONCE (it gave 399.80 twice) | Atomic mint claim in store + "pending" persisted before minting + disabled button while in flight + a race test. Verify on live: total = 399.80, not 799.60. |
| 2 | Believable demo payees | Verified-billers directory (Brightline Fibre `brightline-fibre.testnet`, Metro Power `metro-power-co.testnet`) → counterparty `allow` with reason VERIFIED_BILLER (blocked if reported); a biller picker in Bills and in the agent allowlist; fixtures use them. |
| 3 | Caps consistent (38.50 vs 40/50/100) | One default source (`packages/sdk/src/caps.ts`) used by the UI, the `/connect` link, the connection string, MCP and docs. The consent screen shows exact caps. Find and note the root cause (likely units vs plain amounts in /connect parsing). |
| 4 | MCP install path | `npx oiko-mcp` works now (published). Add a hosted no-install path: `POST /api/agent/session` (agent signs one NEP-413 message → short-lived bearer token, re-checks `view_access_key` each request, revocable). `/api/mcp` accepts Bearer for READ tools; `propose`/`act` return an unsigned tx plus instructions, because the server never holds agent keys. Add a "Connect a hosted agent (Grok, ChatGPT, Claude.ai)" section on /agents and update docs/AGENTS.md. |
| 5 | Disconnect has a confirm step and an "Agent disconnected" state with a tx link | Check in browser. |
| 6 | Access log rows show time, action, amount + ticker, payee, outcome (Approved/Blocked/Refused/Read) and a plain-English reason | E_ codes mapped via `friendlyError`. |
| 7 | Same account across browsers | Settings → "Move to another device": export a passphrase-encrypted sign-in code (QR, copy, .txt); "/start → Sign in with a code". Keys never go to the server. |
| 8 | Invoice page in test mode has a one-click "Simulated payment" | Prefilled, labelled "Simulated, test mode". |
| 9 | Activity page has one obvious "Export CSV" | Reuse the CSV from Settings, accountant-friendly. |
| 10 | Landing hero is fast with no layout shift | Acorn via next/font with `adjustFontFallback`, display weight preloaded, CLS < 0.02. |
| 11/12 | Settings toggle "Show Earn" (and Invest) | Hides Earn nav/tab/chip/copy. |
| 13 | Default plan gives Rainy day 10% | Bills 30, Savings 20, Rainy day 10, Goal 10, Spend 30 in first-run and fixtures. |
| 14 | Fee shown | "You sent 400.00 · fee 0.20 · arrived 399.80" on receipts/activity. |
| 15 | No hidden AI-directed text inside HTML pages | Keep `/llms.txt` and `/.well-known/oiko-agent.json` (standard, separate files); remove any sr-only/hidden prompts in pages. |
| 16 | Robust copy of `oiko1:` string | Clipboard + execCommand fallback + toast + "Download .txt". |
| 17 | Pacing | Skeletons for waits, optimistic UI for non-money actions. |

Also in Phase 1: **G7 old-account banner** on Home/Settings (see Gotchas).

### Phase 2: Zero-config local mode and the e2e suite (README contract for judges)

The work so far is committed as WIP and **unverified**: `docker-compose.yml`, `docker/`, `.dockerignore`, `scripts/local.mjs`, `contracts/tests/src/bin/` (devnet launcher), `e2e/`, `playwright.config.ts`, `scripts/readme-check.ts`.

1. `pnpm local` (no Docker) starts near-sandbox, deploys all contracts (vault as a global contract by hash, mocks with relayer as minter/admin, relayer registered on both tokens), writes `.oiko/relayer.json` + `.oiko/local.env` and starts the web app on :3000. In local mode the server loads `.oiko/local.env` (check `apps/web/server/config.ts`). NearBlocks is off in local mode, so make sure the counterparty check doesn't block the e2e allowlisted payee; adjust local config or tests, never the security rule.
2. `cp .env.example .env && docker compose up` reaches "oiko ready at http://localhost:3000" from a fresh clone with no keys.
3. `pnpm e2e` (Playwright) covers: claim a name; pay 100 USDT from "USDT on TRON" with Simulate → Done → split per plan; Plan → Bills 40% → pay 100 → 40 in Bills; locked pot refuses; withdraw 1 USDT; agent with a 5 USDT cap (scripted agent) → third payment refused → disconnect → reads refused; bill paid by agent shows Paid; earn guard at 93% utilization refused; ROSCA 3 members with 1-minute rounds; vault has zero full-access keys; reduced-motion /home; 360px no horizontal scroll; invoice paid → CSV.
4. `scripts/readme-check.ts` fails if a README step tagged `[e2e: <id>]` has no matching test. Tag the README "Try it" steps.
5. Add Playwright and compose to CI (`.github/workflows/ci.yml` already runs checks, unit tests, typecheck and contracts).

### Phase 3: Proactive agents ("personal intelligence")

Full spec in `docs/ROADMAP.md` §1:
- event push to agents (webhooks + MCP notifications + `GET /api/agent/events?since=`) with deterministic `suggested_actions`
- off-chain proposals for everything non-money (plan changes, pots/goals, locks, Earn on/off, bills, draft invoices), executed by the app key on approval
- opt-in autopilot rules
- `get_month_brief`
- a `how_to_fix` field on refusals

Update `oiko-mcp` (new tools + notifications), bump its version, and have the founder publish (G6).

**Status 2026-11-06: done, except publishing.** Events are derived from state on every request (`apps/web/server/events.ts`), with no event store; webhooks are delivered by cron (`webhooks.ts`, `agentEvents.ts`). Changes: `server/changes.ts` + `packages/sdk/src/changes.ts`; owner endpoints `/api/owner/*`; Home shows them; Agents has Autopilot and each agent's approved/rejected record. `how_to_fix`: `server/howToFix.ts`. Tests: `server/__tests__/proactive.test.ts`, MCP tests, e2e README-14. Not done: autopilot without a connected agent (Oiko holds no key to run it, by design); "counterparty warning on a recent payee" event. **Founder:** publish `oiko-mcp` 0.2.0 (`packages/mcp/oiko-mcp-0.2.0.tgz` is built; see G6).

### Phase 4: Polish, performance, docs, submission

- **Lighthouse** mobile on `/`, `/pay/<name>`, `/home`: performance, accessibility and best practices ≥ 90 each. Store reports in `docs/lighthouse/`. Landing JS < 150 KB gzipped. CLS < 0.02.
- **Accessibility:** AA contrast in light and dark (stars must not reduce text contrast), keyboard, focus rings, reduced motion.
- **Motion check:** no app animation > 420 ms, and reduced-motion removes movement.
- **README** (judges' screening): positioning line first; "Try it" hosted + `pnpm local`/compose; "do X → see Y" steps tagged with e2e ids; test commands with timings; what runs where (Intents has no testnet); a mainnet proof table with "pending" rows (never fake hashes); architecture diagram; the track table (RWM primary, SEC, AGT, DFI); security summary (link SECURITY.md, COUNTERPARTY.md); honest limits; built-with list incl. AI tools (Claude Code, and Grok was used for demo testing); MIT.
- **docs/STATUS.md:** refresh it fully (it lags). **docs/SUBMISSION.md:** check the X post (< 280 chars, no "$"/dollars) and the 2-minute demo script against the current UI.
- **Cron:** remind the founder to set the GitHub variable `OIKO_APP_URL=https://oikodotnear.vercel.app` and secret `CRON_SECRET` (same value as Vercel), so `.github/workflows/cron.yml` runs schedules and ROSCA settlement.
- **Repo public:** the founder runs `gh repo edit devIykee/oiko --visibility public --accept-visibility-change-consequences` after the font licence check.

### Phase 5: Invest and the next vault version (only if time allows; needs founder approval)

- **Gold (XAUT)** is on 1Click (`nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near`).
- **Tokenised stocks/ETFs:** Ondo Global Markets via NEAR Intents and near.com (since Sept 2026: NVDA, TSLA, AAPL, GOOGL, META, MSFT, AMZN, SPY, QQQ). They were NOT in the public 1Click `/v0/tokens` list on 2026-11-05; verify asset IDs, eligibility/compliance and any partner JWT first. "Not available to US persons". Agents get read/propose only.
- **Holding non-stable tokens needs a new vault version** (holdings ledger). Since `oiko.testnet` is locked, deploy a NEW stack under a new root, e.g. `oikoapp.testnet`:
  - Adapt `scripts/deploy-testnet.sh` (use `ROOT=`). The new vault global publish costs about 30 NEAR.
  - Update the Vercel env (`OIKO_ROOT_ACCOUNT`, `OIKO_*`, `OIKO_VAULT_CODE_HASH`) and redeploy.
  - Document migration: users move unlocked funds to a new account.
  - Lock the new registry/ajo with the same method used on 2026-11-05: delete full-access keys after verifying. The `--lock` branch of `redeploy-testnet.sh` aborts on its balance check when the vault is already published; run the key deletion directly as in section 6.

### Phase 6: Mainnet (only with the founder's explicit go-ahead and funds)

- `scripts/deploy-mainnet.sh` (default root `oiko.near`, which must be created and funded first; about 34.7 NEAR). It prints the costs and requires typed confirmation.
- Then `pnpm mainnet-proof` (`scripts/mainnet-proof.ts`, interactive, ≥ 100 USDT for 1Click) and paste the real tx hashes into the README. Never fake hashes.

---

## 5. Open known issues (security review, see docs/SECURITY.md)

- **Fixed in contract code** (vault `72sdtZ…` and the new ajo/registry): V-1 earn lock bypass, V-2 pending returns, V-3 app-key large-amount bypass, A-1/A-2/A-3 ROSCA, R-1/R-2, V-9.
- **Still open (server):**
  - S-1: the per-instance rate limits trust `x-forwarded-for`.
  - S-3: the access log can be spammed with unverified rows.
  - S-5: the mock mint doesn't count against the relayer daily budget.
- **Still open (counterparty):** griefing via a single report with the default threshold 1.
- **Old-code accounts (G7)** still have the pre-fix vault.

---

## 6. Useful commands

```bash
pnpm dev                                         # apps/web dev server (:3000) using apps/web/.env.local (testnet)
OIKO_API=https://oikodotnear.vercel.app pnpm smoke   # live critical path on testnet (~2 min, costs ~0.3 NEAR)
pnpm demo:attack -- --offline                    # prompt-injection attack demo (no chain)
pnpm example:agent                               # scripted agent (needs OIKO_CONNECTION)
pnpm test:unit ; pnpm test:contracts             # vitest ; cargo + sandbox (~3 min)
bash scripts/build-contracts.sh                  # wasm + code hashes into contracts/res
vercel ls oiko ; vercel inspect <url> --logs ; vercel env ls production
# screenshots with fixture data (dev only):  http://localhost:3000/home?fixture=1
# delete full-access keys of an account (irreversible!):
#   near account delete-keys <acct> public-keys <k1,k2> network-config testnet sign-with-legacy-keychain send
```

Vercel production env vars set: `OIKO_NETWORK`, `OIKO_NODE_URL`, `OIKO_ROOT_ACCOUNT`, `OIKO_USDC`, `OIKO_USDT`, `OIKO_LENDING`, `OIKO_AJO`, `OIKO_MPC_SIGNER`, `OIKO_VAULT_CODE_HASH`, `OIKO_VAULT_FUNDING_NEAR` (0.2), `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY`, `CRON_SECRET`, `ADMIN_PASSWORD`, plus Neon's `DATABASE_URL` and related vars. All variables are documented in `.env.example`.
