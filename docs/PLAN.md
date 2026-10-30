# Oiko build plan

Source of truth for scope: `docs/BUILD_PROMPT.md` (+ personal-finance follow-up). This file records how it is built.

## Architecture (as built)

```
apps/web            Next.js App Router: landing, product app, and all HTTP APIs under /api (relayer, intents proxy,
                    1Click mock, agent gateway, MCP over HTTP, cron endpoints). One deployable for Vercel and compose.
packages/sdk        TypeScript client: contract types, view/call helpers, NEP-413, keys, error-code mapping, amounts.
packages/ui         Design tokens, motion tokens, icons, primitives (React).
packages/mcp        @oiko/mcp: MCP server (stdio + streamable HTTP handler) wrapping the agent gateway; signs locally with the agent key.
contracts/*         Rust (near-sdk): registry, vault, ajo, mocks/ft, mocks/lending. Workspace tests with near-workspaces.
examples/agents     scripted agent (no LLM), Claude Desktop MCP config, Telegram bot skeleton.
scripts             deploy (sandbox/testnet), seed, mainnet-proof (human-run), readme-check, check-no-llm, check-copy.
e2e                 Playwright.
```

### Deviations from the build prompt (details and reasons in DECISIONS.md)

1. **No separate services/api process.** The API lives in Next.js route handlers so the hosted demo is one Vercel project. Logic is in plain modules (`apps/web/server/*`) that do not depend on Next, so they can be lifted into a standalone service.
2. **No block-poller indexer in v1.** Each vault keeps an on-chain activity ring buffer (last 200 entries) and monthly stats; the registry keeps counts. Activity, Insights, notifications and landing stats read straight from chain. This removes a stateful service and is verifiable by anyone.
3. **Pots hold both tokens.** A pot has `balances: {usdc, usdt}` instead of one token per pot, so there is exactly one Spend (flex) pot and splits apply to whichever stablecoin arrives.
4. **Bills live on-chain in the vault**, not Postgres, so an agent's `pay_bill` can be checked by the contract.
5. **App key, not meta-transactions, for day-to-day actions.** Registration adds a function-call key (every owner method except `withdraw_large` and `rescue_sign`) on the user's name account with a NEAR allowance funded by the relayer. Vault creation uses the full-access key via a NEP-366 delegate action relayed by `/api/relay`.
6. **Agent intents payouts are proposal-only.** The vault cannot verify that a 1Click deposit address maps to an allow-listed off-NEAR destination, so agents can only pay NEAR accounts directly; cross-chain payouts go through owner approval.
7. **Cron** = GitHub Actions schedule (every 5 min) calling `/api/cron` + the app calling permissionless `sync`/`run_schedules`/`settle_round` when opened.
8. **Login**: passkey (WebAuthn PRF → ed25519 seed, no server secret) with a "this browser" key fallback and a clearly labelled demo login in local mode. Swappable behind `useSession()`.

## Run modes

`OIKO_NETWORK` = `local` (near-sandbox in compose, mock 1Click, mock lending) | `testnet` (hosted demo; real contracts on NEAR testnet, mock 1Click because Intents has no testnet, mock lending) | `mainnet` (real 1Click, real Rhea; human-run only).

## Milestones

M0 scaffold + verification + frozen interfaces → M1 critical path → M2 brand/design/landing → M3 product depth (Plan, Bills, Insights, Earn, schedules, settings, i18n) → M4 ajo → M5 agent gateway + MCP → M6 rescue → M7 invest (flag) → M8 polish, docs, deploy.
