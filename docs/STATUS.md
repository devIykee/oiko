# Status (2026-11-12)

## Works (verified)

- **Contracts** on NEAR testnet: registry `oiko.testnet` and ROSCA `ajo.oiko.testnet` (both **keyless since 2026-11-05**, so nobody can change them), mock USDC/USDT and lending, vault code as a Global Contract (`72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex`). `pnpm test:contracts` passes (unit, proptest invariants, sandbox integration incl. a 3-member ROSCA cycle).
- **Hosted app** https://oikodotnear.vercel.app (auto-deploys from `main`), Postgres (Neon) for nonces, access log, invoices, agent change proposals and settings.
- **Product:** landing, sign-up (passkey or browser key), pay by name from other chains (test-mode 1Click), plan, bills, pots, locks, Earn with a utilization guard, ROSCA savings, invoices with CSV export, insights, activity with CSV export, move to another device, agents.
- **Agents:** MCP (`npx -y oiko-mcp`, 0.2.0 published 2026-11-11 with all 20 tools) and MCP over HTTP with hosted 24-hour links; REST with NEP-413. Read, propose and act within caps the contract enforces; counterparty check before every payment; Disconnect deletes the key.
- **Proactive agents (Phase 3):** events (`/api/agent/events`, signed webhooks delivered by cron, MCP notifications) with deterministic suggested actions; proposals for non-money changes approved on Home; opt-in autopilot rules; month brief; `how_to_fix` on every refusal; each agent's approved/rejected record.
- **Optional payer privacy (flag off):** with `FEATURE_PRIVATE_PAY`, a sender paying from a Gloam private balance on Base or Ethereum gets the exact amount to cash out to the payment address (Gloam fee read live). Hides who paid, not the amount or the balance. See `docs/PRIVACY.md`.
- **Local mode:** `pnpm local` or `docker compose up` with no keys and no testnet; `pnpm e2e` (16 Playwright tests, ~3 min) passes against both. CI runs checks, unit tests, contracts, e2e and a fresh-clone compose run.
- **Checks:** 202 unit tests, typecheck, production build, `check-no-llm`, `check-copy`, `readme-check`.

## Quality (Phase 4)

Lighthouse mobile, see `docs/lighthouse/README.md` for the reports.

| Page | Performance | Accessibility | Best practices | CLS |
|---|---|---|---|---|
| `/` (live) | 86-89 | 100 (was 96) | 100 | 0 |
| `/pay/<name>` (live) | 88-92 (was 80) | 100 | 100 | 0 (was 0.026) |
| `/home` (local production build) | 89-91 | 100 | 100 | 0 |

- Performance sits around the 90 target; what is left is React hydration (about 350-450 ms of blocking time on a throttled phone). LCP is 1.0-1.6 s. Next step if time allows: fewer client components on the landing page.
- Accessibility: axe WCAG 2 A/AA scan of `/`, `/pay`, `/security`, `/how-it-works`, `/docs/agents`, `/start` in light and dark mode: clean after the 2026-11-06 fixes.
- Motion: no animation longer than 420 ms except the decorative night sky and loading spinner; reduced motion stops the sky, reveals and flashes (e2e README-10).
- Fonts: Acorn for headings/UI/amounts, Chillax for supporting text; Acorn's fallback is metric-matched so the swap doesn't shift layout.

## Needs the founder

Done already: `oiko-mcp` 0.2.0 published (2026-11-11); repo public; cron variables set (`.github/workflows/cron.yml` runs on schedule, recent runs green).

1. **Fonts licence check:** the repo is public; confirm the Acorn licence (supplied by you) covers a public repo. Chillax uses the Fontshare free licence.
2. **Submission:** demo video, X post with @NEARProtocol and #NEARHackathon, a mainnet NEAR account for the payout, submit by 2026-11-14 23:59 UTC. Mainnet deployment is optional under the rules (testnet projects are eligible).

## Not finished

- Lighthouse performance ≥ 90 on every run (landing is 86-89; see above).
- Rescue sweeper UI; Invest (flag off).
- Payer privacy with Gloam has not been run with real money: NEAR Intents has no testnet, so a Gloam cash out into a 1Click deposit address is UNVERIFIED (`docs/PRIVACY.md` section 6).
- Autopilot without a connected agent (Oiko holds no key to run it, by design).
- Mainnet proof (Phase 6, only with your go-ahead and funds).
- Open security items: `docs/SECURITY.md` (S-1, S-3, S-5, counterparty report threshold).

## Testnet lock (2026-11-05)

`oiko.testnet` and `ajo.oiko.testnet` have **zero access keys**. Verify with `view_access_key_list`. Demo billers: `brightline-fibre.testnet` (Brightline Fibre), `metro-power-co.testnet` (Metro Power).
