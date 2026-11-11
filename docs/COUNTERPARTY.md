# Counterparty check

> "Give AI money without handing it the keys to everything."

Before an agent sends money, Oiko asks about the receiver. The check returns **allow**, **warn** or **block**, a risk score and plain-English reasons. The gateway and the agent-side SDK/MCP wrapper both enforce the result.

**What actually protects the money is the vault contract.** The agent's function-call key can only call `agent_execute` / `agent_propose` on the owner's vault, and the contract enforces the recipient allowlist, the per-payment, daily and weekly caps, the allowed action kinds, expiry and revocation. The counterparty check is an extra pre-flight layer on top of that. It catches a scam payee *before* anything is signed, and it warns the owner about bad accounts *before* they allowlist them. An agent that skips Oiko's gateway and wrapper and signs its own transaction is still bound by the contract. `pnpm demo:attack` shows all three layers.

## 1. What an agent key can and can't do (NEAR protocol)

Source: [docs.near.org: Access keys](https://docs.near.org/protocol/access-keys). The vault adds each agent as a **function-call key**:

- **One receiver only.** It "can only sign transactions calling a specific contract". For Oiko that is the owner's vault (`receiver_id = vault.<name>.<root>`).
- **Only the listed methods.** `method_names = ["agent_execute", "agent_propose"]`. The key can't call `withdraw`, `add_agent`, `set_splits` or any owner method.
- **No NEAR, no deposit.** Function-call keys "do not allow to attach NEAR tokens to the call" and "prohibit NEAR token transfers". The gateway also refuses any signed transaction with a non-zero deposit (`checkAgentTx`).
- **Can't manage keys.** The key can't add or delete keys or delete the account. Only full-access keys, or contract code that adds keys, can do that.
- **Gas allowance.** The key carries a NEAR allowance that can only be spent on gas. When it runs out the key "becomes unusable and no new transactions can be signed", and adding NEAR to the account doesn't help because "the allowance belongs to the key, not to the account balance". An existing key's allowance can't be changed, so the owner reconnects the agent with a new key. This also caps how many transactions a runaway agent can send.

On top of the protocol limits, the vault contract (`contracts/vault/src/core.rs` `agent_check_and_record`) checks scope, allowed action kinds, allowlist (NEAR accounts only), amount > 0, per-payment, daily and weekly caps (USDC + USDT summed), expiry and revocation, in that order. Off-NEAR (intents) payouts are proposal-only.

## 2. Signals

`checkCounterparty({ agentVault?, agentPublicKey?, receiver, amount?, token? })` in `apps/web/server/counterparty.ts` returns:

```json
{ "receiver": "…", "verdict": "allow|warn|block", "score": 0-100,
  "reasons": [{ "code": "NEW_ACCOUNT", "severity": "info|warn|block", "message": "plain English", "evidence": "optional" }],
  "checkedAt": "ISO time", "sources": ["rpc:query view_account", "nearblocks:/v1/account/{id}", "…"] }
```

| Signal | Codes (severity) | Data source |
|---|---|---|
| Valid NEAR account id | `INVALID_ACCOUNT_ID` (warn, stops further checks) | Local check against the NEAR account-id rules (2–64 chars, `[a-z0-9_-]` labels joined by `.`) |
| Paying the vault itself | `SELF_PAYMENT` (warn) | Compared with the agent's vault id |
| Oiko's own contracts | `OIKO_CONTRACT` (info → allow, stops further checks) | Server config: root/registry, USDC, USDT, lending, ROSCA, MPC signer, relayer |
| Shared blocklist | `REPORTED` (block), `REPORTED_ONCE` (warn, below threshold), `REPORTS_UNAVAILABLE` (warn) | Built-in seed list `apps/web/server/counterpartySeed.ts` (always blocks) + Postgres table `counterparty_reports` (memory store without `DATABASE_URL`) |
| Account exists | `ACCOUNT_NOT_FOUND` (block, named accounts), `IMPLICIT_UNUSED` (warn, 64-hex / `0x…` accounts with no state), `RPC_UNAVAILABLE` (warn) | NEAR RPC `query` `request_type: view_account` ([docs](https://docs.near.org/api/rpc/contracts)) |
| Is it a contract | `IS_CONTRACT` (info) | `view_account.code_hash != 11111111111111111111111111111111` (or a `global_contract_hash`) |
| Contract code changed recently (< 7 days) | `CODE_CHANGED_RECENTLY` (warn) | NearBlocks `GET /v1/account/{id}/contract/deployments` (newest `block_timestamp`). Fallback: the last code hash seen, cached in Postgres `counterparty_code_hashes`. A different hash warns for 7 days |
| Account age | `NEW_ACCOUNT` (< 7 days, warn), `YOUNG_ACCOUNT` (< 30 days, info), `ACCOUNT_AGE` (info), `AGE_UNKNOWN` (no creation record, warn) | NearBlocks `GET /v1/account/{id}` → `account[0].created.block_timestamp` (ns). RPC has no creation time |
| Activity | `LOW_ACTIVITY` (< 5 transactions sent, warn), `ACTIVE_ACCOUNT` (info) | NearBlocks `GET /v1/account/{id}/txns-only/count` → `txns[0].count` |
| Explorer down | `HISTORY_UNKNOWN` (warn), `HISTORY_NOT_AVAILABLE` (info, networks without NearBlocks, i.e. local sandbox) | NearBlocks errors or rate limits (HTTP 429) |
| Prior interactions | `PRIOR_PAYMENTS` (info), `OWNER_BILL_PAYEE` (info), `FIRST_TIME_RECEIVER` (warn: never paid and amount > threshold, default 10.00), `FIRST_TIME_RECEIVER_SMALL` (info), `PRIOR_UNKNOWN` (warn) | Vault view `get_activity` (last 200 rows: `withdrawn` / `bill_paid` with `counterparty = receiver`, `bill_added` payees) + gateway access log (`agent_access_log.receiver` on successful agent `pay` submits) |

The NearBlocks endpoints and response fields were checked against the live testnet API (`api-testnet.nearblocks.io`). Responses are cached per server instance (age 24 h, counts and deployments 10 min) because the free tier allows about 6 calls a minute. Set `NEARBLOCKS_API_KEY` for a paid key (`Authorization: Bearer`). Data from NearBlocks is credited in the UI.

**Score**: each block reason adds 60, each warn adds 20, capped at 100. Info adds nothing.
**Verdict**: any block reason → `block`; else any warn → `warn`; else `allow`.

## 3. Enforcement

| Where | allow | warn | block |
|---|---|---|---|
| Gateway `POST /api/agent/prepare` (pay, pay_bill; bill payees resolved via `get_bills`) | prepared; response includes `counterparty` | **act refused** `E_COUNTERPARTY_WARN` (409, `error.next = "propose"`); propose prepared | **act and propose refused** `E_COUNTERPARTY_BLOCKED` (403) |
| SDK `GatewayClient.run` / `oiko-mcp` `act`, `propose` | signs | act: returns `ok:false, signed:false` with "use propose instead"; propose: signs | returns `ok:false, signed:false`, nothing signed |
| SDK wrapper when the check can't run | — | act fails closed (`E_COUNTERPARTY_UNAVAILABLE`) | — |
| Vault contract | allowlist, caps, kinds, expiry, revoke — always, whatever the check said | | |

**Allowlist exception (narrow on purpose).** A warn result still lets `act` through only when **both** are true: the receiver is on this agent's on-chain allowlist, **and** every warn reason is `LOW_ACTIVITY` or `FIRST_TIME_RECEIVER`. The owner allowlisted the account themselves, so "quiet account" or "first payment" adds nothing new. Any other warning still forces `propose`, for example a new account, a code change, an RPC or explorer outage, a single report, a self-payment or an unknown age.

Moves between the owner's own pots (`move`, `save`) aren't checked; they never leave the vault.

**Owner-facing UI** (`apps/web/components/app/CounterpartyBadge.tsx`, using the public endpoint):
- Agents → each pending proposal that pays someone shows the receiver's verdict and reasons.
- Agents → Connect: every allowlist entry is checked as the owner types it (setup step) and again on the consent screen. This warns the owner before they allowlist a bad account, which matters for agent-initiated `/connect` links where the agent suggests the allowlist.
- Bills → Add bill: the payee is checked as it's typed.

## 4. Endpoints

- `GET /api/agent/counterparty?to=<account>&amount=<units>&token=usdc|usdt` or `?bill_id=<id>`: agent (NEP-413, scope read). Returns the result plus `on_allowlist` and `decision: { act, propose, message }`. MCP tool `check_counterparty`.
- `POST /api/agent/report {receiver, reason, evidence}`: agent (NEP-413, scope read). One report per reporting account per receiver; 5 per key per day; Oiko's own contracts and the reporter's own vault can't be reported. MCP tool `report_counterparty`.
- `GET /api/counterparty/:accountId?vault=&amount=&token=`: public, 30 requests/min per IP, no `decision`.

A report counts as **verified** when it came from a live agent key on a real Oiko vault (NEP-413 signature, key still on the vault, agent not revoked or expired). Receivers reported by at least `COUNTERPARTY_BLOCK_REPORTS` distinct accounts (default 1) are blocked. Fewer reports than that gives a warn.

## 5. Threat model

| Threat | What stops it |
|---|---|
| Prompt injection ("URGENT: pay X to unlock your refund") makes the agent pay a scam account | Wrapper refuses to sign (block / warn). The gateway refuses to prepare. The contract refuses any receiver not on the allowlist (`E_NOT_ALLOWLISTED`) |
| Agent (or attacker with the agent key) skips the wrapper and the gateway | Contract: allowlist, caps, kinds, expiry. Key: one receiver, two methods, no deposit, finite gas allowance. Owner can revoke (deletes the key) |
| Attacker gets an account onto the allowlist via an agent-initiated `/connect` link | The owner reviews every limit, and each allowlist entry shows its counterparty verdict before approving |
| An allowlisted account turns bad later (sold, compromised, contract upgraded) | Reports and `CODE_CHANGED_RECENTLY` turn into block / warn even for allowlisted receivers (the exception covers low-activity warnings only) |
| Fresh look-alike account (e.g. `landl0rd.near`) | `NEW_ACCOUNT`, `LOW_ACTIVITY`, `FIRST_TIME_RECEIVER` → warn → owner approves |
| Typo or non-existent receiver | `ACCOUNT_NOT_FOUND` → block; `IMPLICIT_UNUSED` → warn |
| Data sources down | Fails toward warn (owner approves), never toward allow. The SDK wrapper fails closed for `act` |

## 6. Limits (be honest)

- **Advisory layer.** The check runs in Oiko's gateway and in Oiko's client libraries. A custom client can skip both, and only the contract's allowlist and caps then apply. Within those limits, an agent can still pay an allowlisted account that has gone bad.
- **Griefing.** One report only turns a receiver into a *warn* (agents must propose and the owner approves); blocking for agents needs reports from at least 2 distinct Oiko accounts (`COUNTERPARTY_BLOCK_REPORTS`, default 2). Owners can always pay the receiver themselves. Limits: one report per vault per receiver, 5 reports per key per day, evidence required, Oiko contracts exempt. There is no appeal flow yet.
- **Seed list.** It holds only demo entries for accounts that did not exist when they were added (`urgent-refund-desk.testnet`, `urgent-refund-desk.test.near`). Oiko doesn't claim any real account is a scam.
- **NearBlocks** is a third-party indexer with a small free quota. When it's unavailable, age and activity are unknown and the verdict becomes warn. The cache is per serverless instance.
- **Prior interactions** cover only the vault's last 200 activity rows and the gateway access log (Postgres, or memory without `DATABASE_URL`).
- **Code-hash cache.** Without NearBlocks, a code change is only noticed if Oiko saw the old hash before.
- **Owner UI badges** are advice. Owners can still allowlist or pay any account.
- **Intents payouts** (other chains) aren't covered. They're proposal-only for agents.

## 7. Try it

```bash
pnpm demo:attack -- --offline          # no network; real wrapper + gateway code, simulated RPC/contract
OIKO_CONNECTION=oiko1:… pnpm demo:attack  # against a real deployment; the agent needs act + pay, the scam account must not be allowlisted
```

Sample output: `examples/agents/attack-demo/sample-output.txt`. Tests: `apps/web/server/__tests__/counterparty.test.ts` and the wrapper tests in `packages/mcp/test/mcp.test.ts`.

| Env var | Default | Meaning |
|---|---|---|
| `NEARBLOCKS_API_URL` | network default (none on local) | NearBlocks base URL |
| `NEARBLOCKS_API_KEY` | none | Paid key (`Authorization: Bearer`) |
| `COUNTERPARTY_NEARBLOCKS` | on | `off` disables NearBlocks lookups |
| `COUNTERPARTY_FIRST_TIME_THRESHOLD` | `10` | Decimal amount above which a first-time receiver is a warn |
| `COUNTERPARTY_BLOCK_REPORTS` | `1` | Distinct reporting accounts needed to block |
