# Status (2026-11-06)

## Works (verified)

- **Contracts** on NEAR testnet: registry `oiko.testnet` and ROSCA `ajo.oiko.testnet` (both **keyless since 2026-11-05**, so nobody can change them), mock USDC/USDT and lending, vault code as a Global Contract (`72sdtZyfMEdLh2RSqSjBAPt73PpsHCr24irGCi9yahex`). `pnpm test:contracts` passes (unit, proptest invariants, sandbox integration incl. a 3-member ROSCA cycle).
- **Hosted app** https://oikodotnear.vercel.app (auto-deploys from `main`), Postgres (Neon) for nonces, access log, invoices, agent change proposals and settings.
- **Product:** landing, sign-up (passkey or browser key), pay by name from other chains (test-mode 1Click), plan, bills, pots, locks, Earn with a utilization guard, ROSCA savings, invoices with CSV export, insights, activity with CSV export, move to another device, agents.
- **Agents:** MCP (`npx -y oiko-mcp`, 0.1.0 published; 0.2.0 built, not yet published) and MCP over HTTP with hosted 24-hour links; REST with NEP-413. Read, propose and act within caps the contract enforces; counterparty check before every payment; Disconnect deletes the key.
- **Proactive agents (Phase 3):** events (`/api/agent/events`, signed webhooks delivered by cron, MCP notifications) with deterministic suggested actions; proposals for non-money changes approved on Home; opt-in autopilot rules; month brief; `how_to_fix` on every refusal; each agent's approved/rejected record.
- **Local mode:** `pnpm local` or `docker compose up` with no keys and no testnet; `pnpm e2e` (14 Playwright tests, ~3 min) passes against both. CI runs checks, unit tests, contracts, e2e and a fresh-clone compose run.
- **Checks:** 179 unit tests, typecheck, production build, `check-no-llm`, `check-copy`, `readme-check`.

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

1. **Publish `oiko-mcp` 0.2.0** (2FA in your own terminal): `npm publish ./packages/mcp/oiko-mcp-0.2.0.tgz --access public`.
2. **Cron:** GitHub variable `OIKO_APP_URL=https://oikodotnear.vercel.app` and secret `CRON_SECRET` (same value as in Vercel). Without them schedules, ROSCA settlement and agent webhooks don't run on their own.
3. **Fonts licence check, then make the repo public:** Acorn (supplied by you) and Chillax (Fontshare free licence) are in `apps/web/fonts`. Then `gh repo edit devIykee/oiko --visibility public --accept-visibility-change-consequences`.
4. **Submission** (`docs/SUBMISSION.md`): demo video, X post with @NEARProtocol and #NEARHackathon, a mainnet NEAR account for the payout, submit by 2026-11-14 23:59 UTC. Mainnet deployment is optional under the rules (testnet projects are eligible).

## Not finished

- Lighthouse performance ≥ 90 on every run (landing is 86-89; see above).
- Rescue sweeper UI; Invest (flag off).
- Autopilot without a connected agent (Oiko holds no key to run it, by design).
- Mainnet proof (Phase 6, only with your go-ahead and funds).
- Open security items: `docs/SECURITY.md` (S-1, S-3, S-5, counterparty report threshold).

## Testnet lock (2026-11-05)

`oiko.testnet` and `ajo.oiko.testnet` have **zero access keys**. Verify with `view_access_key_list`. Demo billers: `brightline-fibre.testnet` (Brightline Fibre), `metro-power-co.testnet` (Metro Power).
