# Oiko roadmap: remaining features

Status as of 2026-11-05. "Personal finance meets personal intelligence" means: Oiko runs the money rules, and the user's own AI agent watches, suggests and acts within limits the account enforces. Oiko itself still ships no built-in AI.

## 1. Proactive agents (personal intelligence)

Today an agent can read everything, act within caps (pay allowlisted payees, pay bills, move between pots, save) and propose payments. It only acts when it asks; Oiko never tells it anything happened.

### 1.1 Event push to agents
- **Events:** payment received, plan applied, bill due in 3 days / due today / missed, goal reached, Spend low (below a user-set floor), lock released, invoice paid / overdue, ROSCA round due / paid / default, cap at 80%, counterparty warning on a recent payee, weekly summary.
- **Delivery:**
  - signed webhooks (HMAC, retries, per-agent URL from the connect flow)
  - MCP notifications over streamable HTTP (`notifications/message` + a `get_events(since)` tool for agents that poll)
  - a REST `GET /api/agent/events?since=` cursor
- **Event shape:** each event carries `suggested_actions` (deterministic, computed by code). For example "Bills has 120.00 but 165.00 is due this month → propose moving 45.00 from Spend". The agent decides what to do with them.
- **Scope:** new scope `events` (implied by `read`). Events also go to the access log.

### 1.2 Proposals for everything (one-tap approval)
Agents can propose, with a reason the user sees in quotes:
- plan changes: split percentages, add or remove rules
- new pot / goal (name, target, date), rename
- lock or extend a lock (never shorten; the contract has no such method)
- Earn on/off for a pot (with today's rate and the risk note)
- new bill / edit bill, recurring savings schedule
- draft invoice (the user reviews and sends it)
- ROSCA: join a group from an invite, contribute this round

Non-money configuration proposals are stored off-chain (Postgres) and executed by the user's app key when approved, so no contract change is needed. Money proposals stay on-chain (`agent_propose`).

### 1.3 Autopilot rules (opt-in, capped)
- The user turns on rules such as "on every payment, top Bills up to this month's bills total", "sweep Spend above 300.00 into Savings on Fridays" or "pay bills on their due day".
- The agent (or Oiko's cron, for users without an agent) executes them via `agent_execute` within caps. Every run is attributed in Activity.

### 1.4 Agent quality of life
- **Monthly brief tool:** `get_month_brief(month)` returns a deterministic summary (in, out, saved, biggest changes, upcoming bills) the agent can explain in its own words.
- **Explain refusals:** every refusal returns a `how_to_fix` field, e.g. "ask the owner to raise the weekly cap to 60.00".
- **Publish the MCP package:** publish `@oiko/mcp` to npm so `npx @oiko/mcp` works.
- **Agent reputation:** per-agent history of proposals approved vs rejected, shown on the agent card.

## 2. Invest

Behind `FEATURE_INVEST`, with a risk sheet before the first buy, no agent auto-buying, and not available to US persons.

### 2.1 Gold (XAUT)
- XAUT is listed on 1Click today (`nep141:eth-0x68749665ff8d2d112fa859aa293f07a622782f38.omft.near`).
- **Buy:** "Buy with USDT/USDC" swaps from a pot through a 1Click quote.
- **Sell:** sells back to a stablecoin pot.
- **Display:** price from the quote, plus a sparkline from a cached public source.

### 2.2 Tokenised stocks and ETFs on NEAR (Ondo via NEAR Intents)
- **What exists:** Ondo Global Markets tokenised stocks and ETFs, reachable through NEAR Intents and near.com since September 2026. Launch assets include NVDA, TSLA, AAPL, GOOGL, META, MSFT and AMZN, plus SPY and QQQ ETFs ([NEAR blog](https://www.near.org/blog/tokenized-stocks-rwas-ondo), [Cryptonomist](https://en.cryptonomist.ch/2026/09/22/tokenized-stocks-access-ondo/)).
- **To verify before building:**
  - the exact asset IDs and whether the public 1Click API exposes them (the public `/v0/tokens` list did not include them on 2026-11-05)
  - eligibility and compliance controls, and any partner or JWT requirement
  - settlement times and fees
  - what holders actually own: tokenised stocks usually give price exposure, not shareholder voting rights
- **Product:**
  - an "Invest" tab with a short curated list (a handful of stocks plus SPY/QQQ)
  - buy with USDT or USDC from a chosen pot, sell back to stablecoins
  - each holding shown at its live quote value with the ticker, never mixed into "Total stables"
  - eligibility gating with a "not available to US persons" note, and per-asset risk notes
- **Custody:** holdings sit in the user's keyless account like everything else. The vault needs a new holdings ledger for non-stable tokens; this is a contract change, so it ships with the next vault version (users move unlocked funds to the new account, as documented).
- **Agents:** read-only by default (`get_holdings`). Buying or selling is proposal-only, never `act`.

## 3. Finishing work already started

- **Local mode and tests:** zero-config local mode (`docker compose up` with a sandbox chain), the Playwright e2e suite, and `scripts/readme-check.ts` (in progress).
- **Performance:** Lighthouse reports for `/`, `/pay/[name]` and `/home`, stored in `docs/lighthouse/`.
- **UI pass (in progress):**
  - night-sky dark mode
  - Acorn as the single font
  - stacked pot cards
  - Home sections and money-only recent activity
  - "Total stables" wording
  - sticky-phone overflow fix
  - `/admin` framing switch
- **Lock testnet:** `bash scripts/redeploy-testnet.sh --lock`, after checking the live app, makes the registry and ROSCA contract keyless.
- **Rescue:** the sweeper UI for wrong-chain deposits to the permanent EVM/TRON address (`rescue_sign` exists in the contract; there is no UI or sweeper yet).
- **Push notifications:** web push (VAPID) for payments received, bills due, invoices paid and agent actions.
- **ROSCA + Sputnik DAO:** a DAO per group to vote out a defaulter or change reminders (Social Money track stretch).
- **Recovery:** add a second passkey, export a recovery code, and a "sign in on a new device" walkthrough.

## 4. Launch steps (human)

- **Repo:** make the repo public after confirming the Acorn font licence allows it.
- **Cron:** set GitHub `OIKO_APP_URL` and the `CRON_SECRET` secret so schedules and ROSCA settlement run every 5 minutes.
- **Mainnet:** fund `oiko.near` (≈ 34.7 NEAR) and run `scripts/deploy-mainnet.sh`, which asks for a typed confirmation, then `scripts/mainnet-proof.ts`. Not planned for now; the `/admin` framing switch covers presentation.
