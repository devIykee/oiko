# Status (2026-11-04)

## Works (verified)

- Contracts: registry, keyless vault (pots, plan/splits, locks, withdraw, Earn guard, agents with caps/allowlist/expiry, proposals, schedules, bills, ROSCA hooks, rescue_sign), ROSCA (`ajo`) contract, mock USDC/USDT, mock lending. `cargo test --workspace` passes (unit + proptest invariants + sandbox integration incl. a full 3-member ROSCA cycle).
- Deployed on NEAR testnet (see README). Vault code published as a Global Contract.
- Hosted app: https://oikodotnear.vercel.app (Vercel project `oiko`, linked to GitHub `devIykee/oiko`, auto-deploys from `main`).
- Live critical path on testnet passes end to end (`pnpm smoke`): register → keyless account → pay 100 USDT via 1Click proxy → plan split → lock refusal → withdraw → agent within cap, over-cap refused → revoke deletes key → reads refused.
- 68 unit tests, no-LLM check, banned-words check, typecheck, production build: all pass.
- Product UI: landing, /start (passkey or browser key), /pay/[name], home, plan, bills, pots, earn, ROSCA, insights, agents (connect, caps, proposals, disconnect), activity, settings, /connect, /security, /how-it-works; MCP stdio package and HTTP endpoint; scripted example agent; Telegram skeleton.

## Blocked on you

1. **Fund the relayer**: send testnet NEAR to `oiko-relayer.testnet` (faucet: https://near-faucet.io). It has ~0.6 NEAR; each signup costs ~0.6 + fees. 20-30 NEAR ≈ 35 signups. Until then, signup on the hosted demo fails with "needs a top-up".
2. ~~Database~~ Done (2026-11-04): Neon is connected to the Vercel project (`DATABASE_URL`). Nonces, the agent access log and test-mode payments are now stored in Postgres; verified on production by looking up a deposit across instances without its ticket.
3. **Make the repo public** before submitting: `gh repo edit devIykee/oiko --visibility public --accept-visibility-change-consequences`. Check first that you may publish the Acorn font files in `apps/web/fonts` (otherwise remove them; the site falls back to Inter Tight).
4. **Cron**: set GitHub repo variable `OIKO_APP_URL=https://oikodotnear.vercel.app` and secret `CRON_SECRET` (same value as the Vercel env var) so `.github/workflows/cron.yml` runs schedules and ROSCA settlement every 5 minutes.

## Not finished

- Zero-config local mode (`docker compose up` with a sandbox chain) and the Playwright e2e suite + `scripts/readme-check.ts`.
- `docs/SECURITY.md`, `docs/AGENTS.md` long-form docs (agent docs exist as `/llms.txt`, `/.well-known/oiko-agent.json`, `/openapi.json`), `scripts/mainnet-proof.ts`.
- Lighthouse reports, rescue sweeper UI, Invest (flag off).

## Next commands

```bash
OIKO_API=https://oikodotnear.vercel.app pnpm smoke   # after funding the relayer
pnpm test:unit && pnpm test:contracts
```
