# Oiko security model

This document describes how Oiko protects money, what it trusts, and what is not protected yet. It is written for reviewers and developers. Every statement points at code; where something is a plan or an assumption it says so. Oiko has **not been audited**.

Code references: contracts in `contracts/{vault,registry,ajo,common}/src`, server in `apps/web/server`, SDK in `packages/sdk`, MCP server in `packages/mcp`. Error codes: `contracts/ERRORS.md`. Interfaces: `docs/interfaces/`.

## 1. Custody model

Each user gets two NEAR accounts under the root (`oiko.testnet` on testnet, configurable `OIKO_ROOT_ACCOUNT` on mainnet):

| Account | Holds | Keys | Code |
|---|---|---|---|
| `<name>.<root>` (identity) | a little NEAR for gas | 1 full-access **owner key**, 1 function-call **app key** (added by the registry at creation, `registry/src/lib.rs` `register_name`) | none |
| `vault.<name>.<root>` (the money) | all USDC and USDT, split into pots | **none at creation**. Later only the agent function-call keys the vault adds to itself (`add_agent`) | vault code, used by hash as a NEAR Global Contract |

- The vault is created by the user's own owner key in one NEP-366 delegate action relayed by `/api/relay`: `CreateAccount → Transfer → UseGlobalContract(code hash) → FunctionCall new`. There is no `AddKey` in that batch; the relayer refuses any other shape (section 5).
- `vault.new` refuses unless `predecessor == owner` and the vault account is exactly `vault.<owner>` (`vault/src/lib.rs` `new`).
- **No upgrade method and no admin.** The vault has no method that deploys code, adds a full-access key, changes the owner, or shortens a lock. Vault code is referenced by code hash (testnet: `3G9Gwhrtq8gN1ugLLNBShdjbw3s1imNH8FVrUXYWTPPR`), and a hash-referenced global contract cannot be changed by its publisher. Moving to new code means moving unlocked money to a new account.
- Every owner method checks `predecessor == owner` (`assert_owner`). The owner is the identity account, so any key on that account that is allowed to call the method can act as the owner.
- **Contract accounts on testnet still have deployer keys.** On 2026-11-04 `view_access_key_list` showed one full-access key on each of `oiko.testnet` (registry), `ajo.oiko.testnet`, `lending.oiko.testnet` and `usdc.oiko.testnet`. `scripts/deploy-testnet.sh` does not delete them. So on testnet the registry and the ROSCA savings contract can still be redeployed by whoever holds those keys, and money held by `ajo.oiko.testnet` (contributions and bonds) is not trust-minimised. User vaults are not affected: they have no keys and use the code by hash. Deleting these keys is a deployment step still to be done.

## 2. Access keys

| Key | Where | Can call | Limit |
|---|---|---|---|
| Owner key (full access) | identity account | everything, including `withdraw_large` and the payable `rescue_sign` | none. Derived on demand from a passkey (WebAuthn PRF → ed25519 seed, not stored), or kept in browser storage when the user picks "this browser" (`apps/web/lib/session.tsx`) |
| App key (function call) | identity account, receiver = the vault | every owner method except `withdraw_large` and `rescue_sign`, plus `sync` and `run_schedules` (`oiko_common::APP_KEY_METHODS`, `common/src/lib.rs`) | 0.25 NEAR gas allowance; function-call keys cannot attach a deposit. Stored in browser `localStorage` |
| Agent key (function call) | the vault itself, receiver = the vault | `agent_execute`, `agent_propose` only (`AGENT_METHODS`) | `config.agent_allowance` NEAR for gas (paid from the vault's balance); the policy in the vault (section 4) |

What the app key can do matters most: it can reach **all unlocked money**. `withdraw` is capped per call by `large_withdrawal_threshold`, but the cap is per call and not a boundary. The app key can also call `add_agent` (any caps, any allowlist) and `approve_proposal`, and an approved `pay` proposal pays any amount without the threshold check (`run_action`). Locked pots stay locked whichever key is used. See finding V-3.

## 3. Vault invariants and tests

Property tests in `contracts/vault/src/core.rs` (`ledger_invariants`, `agent_caps_hold`, `split_conserves`, 256 cases each) check, after every random operation:

1. `accounted[t] == Σ pots.balances[t] + in_flight[t]` for each token.
2. A split puts the whole payment somewhere: Σ allocations == deposit, and Spend gets the remainder.
3. A locked pot's `balances + earn_supplied` never goes down before `unlock_at`.
4. `unlock_at` never goes down (`lock` and `extend_lock` refuse to shorten).
5. Agent spend never exceeds `per_tx`, the daily cap (UTC day) or the weekly cap.
6. `sync` is idempotent and never credits more than `real balance − accounted`, and credits nothing when an outflow finished between the balance read and the callback (per-token `epoch`).

Unit tests (`core.rs`, `vault/src/tests.rs`) cover lock rules, outflow success and failure, stale sync, the Earn round trip, policy validation, agent self-signing, rescue validation, schedules and bills. Sandbox integration tests (`contracts/tests/tests/critical_path.rs`, `ajo_cycle.rs`) run the production path: global contract, keyless vault, sync and `ft_on_transfer`, locks refusing both keys, the app key refused on `withdraw_large`, cap and allowlist refusals, agent calls refused from the owner key, propose/approve/reject, revoke deleting the key, the Earn guard, and a three-member ROSCA cycle with a default. Run with `pnpm test:contracts`.

Not covered by these properties: concurrent `earn_off` (finding V-1), lending returns that differ from the amount asked for (V-2), and gas use at the maximum configuration (V-9).

## 4. Agent model

- **Scopes:** `read`, `propose`, `act`. Reads go through the gateway; `propose` and `act` are the on-chain methods `agent_propose` and `agent_execute`.
- **On-chain checks for `agent_execute`** (`core.rs` `agent_check_and_record`): not revoked, not expired, `act` scope, action kind allowed (`pay`, `move_between_pots`, `save`; `pay_bill` counts as `pay`), recipient on the allowlist (NEAR accounts only; `pay_bill` checks the bill's payee), amount ≤ `per_tx`, day and week windows. USDC and USDT are summed. Every kind counts against the caps, moves included. Payments come from Spend only, and locked pots refuse outflows to everyone. A failed transfer rolls back the recorded spend.
- **Proposals:** at most 20 pending per agent, expire after 7 days. Approval runs the action with owner authority: locks still apply, the allowlist and caps do not. Revoking an agent closes its pending proposals.
- **Revoke** marks the policy revoked and deletes the key from the vault. The gateway checks that the key still exists, so reads stop too.
- **Off-NEAR payouts:** an agent cannot pay to another chain directly. `AgentAction::Pay.to` is a NEAR account, and a 1Click deposit address is not on an allowlist, so cross-chain payouts are proposal-only.
- Expiry is at most 90 days after `add_agent`.

## 5. Server components

### Agent gateway (NEP-413), `apps/web/server/gateway.ts`
- Header `Authorization: NEP413 <base64(json {accountId, publicKey, signature, nonce, message})>`; NEP-413 recipient `oiko-gateway`; `message = "<METHOD> <path incl. query>\n<sha256 hex of body>\n<unix ms>"`.
- Checks: method and path match the request, body hash matches, timestamp within 5 minutes, ed25519 signature, nonce not seen before (kept for 2 × the window), `accountId` is a vault id, the key still exists on that vault and (if it is a function-call key) its receiver is the vault, the policy exists, is not revoked or expired, and has the scope.
- `/api/agent/submit` accepts only one `agent_execute`/`agent_propose` function call with zero deposit, signed by the authenticated key, with signer and receiver both the vault. It verifies the signature before broadcasting. The contract decides caps and allowlist; the gateway does not pre-check them.
- `/api/agent/log` requires a NEP-413 signature from a key on the identity account, and only returns that account's vault log.
- MCP over HTTP (`/api/mcp`) uses the same authentication on every POST. It cannot sign, so `propose`/`act` return an unsigned transaction unless `signed_tx` is passed.

### Relayer, `apps/web/server/relayer.ts`
- `/api/register`: name must match `NAME_RE`, keys must be ed25519 and different, name available. The relayer attaches `registry.config().account_funding` (1.5 NEAR on testnet) to `register_name`.
- `/api/relay` allow-list (`checkDelegate`): sender is `<name>.<root>`, receiver is `vault.<sender>`, 1–4 actions in the order CreateAccount → Transfer (≤ `RELAY_MAX_TRANSFER_NEAR`) → UseGlobalContract (code hash in the env or registry trusted set; the account-id form is refused) or DeployContract (sha256 in the trusted set) → FunctionCall `new` (deposit 0, gas ≤ 300 Tgas, `owner == sender`, `usdc`/`usdt` = configured). No action repeats. A batch that creates the account must also set trusted code. The signature and `maxBlockHeight` are checked before the relayer spends gas. The rest of `new`'s `config` (lending, ajo, thresholds, agent allowance) is the user's choice and affects only their own vault.
- `/api/topup` sends NEAR to an Oiko account (identity or vault) whose free balance is below the threshold. `/api/sync` calls the permissionless `sync()`.

### Rate limits and budget, `apps/web/server/ratelimit.ts`
Token buckets per IP and per account: register 5/h per IP and 2/h per name; relay 20/h per IP and 5/h per account; topup 10/h per IP and 3/day per account; sync 60/min per IP and 6/min per vault; gateway and MCP 120/min per IP and 60/min per key; intents 30/min; simulate 10/min. There is also a global daily relayer budget (`RELAYER_DAILY_BUDGET_NEAR`). These limits are **in memory per server instance**, so on serverless they are best effort. The client IP comes from `x-forwarded-for`, which a client can set when the app is not behind a proxy that overwrites it.

### Storage
With `DATABASE_URL`, nonces, the access log, push subscriptions and mock swaps are kept in Postgres. Without it they are kept in memory per instance: nonce replay protection and the access log reset on restart and are not shared between instances.

## 6. Threats

| Threat | What stops it | What remains |
|---|---|---|
| Stolen app key (browser storage, malware, XSS) | Cannot call `withdraw_large`, `rescue_sign` or anything with a deposit; gas capped by 0.25 NEAR allowance; locks hold | Can move **all unlocked money**: repeated `withdraw`, or `add_agent` with an attacker key and large caps, or approving its own `pay` proposal (V-3). Recovery = owner key deletes the app key |
| Stolen agent key | Contract caps (`per_tx`, day, week), allowlist, kinds, expiry; payments only from Spend; owner revoke deletes the key | Can spend up to the caps to allowlisted payees, move money between unlocked pots within caps, burn up to `agent_allowance` of the vault's NEAR on gas |
| Malicious or prompt-injected agent | Same as above; proposals need an owner tap | A persuasive proposal reason. The owner sees the recipient and amount before approving; approval skips the allowlist |
| Relayer compromise | Relayer has no key on any vault or identity account; the registry only lets it call `register_name` | Can stop sponsoring (users can still act by paying their own gas), refuse service, spend its own NEAR. Can register names with keys it chooses (only new accounts) |
| Gateway compromise | Agents sign transactions locally (stdio MCP, SDK); the contract re-checks every limit; the gateway holds no keys | Can serve wrong read data, drop or delay agent transactions, write a false access log. Cannot exceed an agent's on-chain policy |
| 1Click route failure | Deposits name a refund address on the origin chain; status is polled and shown; withdrawals refund to the vault (`refundTo = vaultId`) | Delays; fees as quoted; a refund to the sender instead of delivery |
| Rhea (lending) risk | Earn is opt-in per pot; Spend can never be lent (`E_FLEX_EARN`); `earn_on` refuses above `max_utilization_bps` (≤ 95%, 92% in the app); withdrawals read the real supplied balance | Insolvency, exploit or a liquidity crunch can delay or reduce Earn funds, including funds of locked pots that use Earn. Rates are variable and can go to zero |
| Stablecoin issuer freeze | Disclosed in the app; a vault can hold both tokens | An issuer can freeze or blacklist the vault's balance. USDC and USDT are stablecoins designed to track the US dollar. They are not dollars and are not bank deposits. They can lose their peg and issuers can freeze them. |
| Front-end compromise (hosted app or supply chain) | The vault contract still enforces locks; `withdraw_large` and `rescue_sign` need the owner key; code hash shown on `/security` can be checked on the explorer | A malicious page can use the app key (all unlocked money) and, when the user re-authenticates with a passkey or uses "this browser" sign-in, the owner key |
| Replay | Gateway: single-use 32-byte nonce + 5-minute window + signed method, path, query and body hash. Transactions: NEAR access-key nonces. Delegates: nonce + `maxBlockHeight` | Without `DATABASE_URL`, a gateway request could be replayed on another instance within 5 minutes (reads, or a `prepare`, which only builds a transaction) |
| Deposit counted twice | `ft_on_transfer` does not credit directly; it uses the same balance read as `sync`, credit = `real − accounted`, epoch guard | — |
| Contract admin | No upgrade or admin method on vault, registry or ROSCA savings contract | Testnet registry and ROSCA savings accounts still have deployer full-access keys (section 1) |

## 7. Review findings (2026-11-04)

Scope: the vault, registry and ROSCA savings (`ajo`) contracts, and `gateway.ts`, `agentHttp.ts`, `mcp.ts`, `relayer.ts`, `intents.ts`, `mock1click.ts`, `ratelimit.ts`. Contracts are deployed and immutable, so contract findings are documented, not changed.

| Id | Severity | Where | Finding | Status |
|---|---|---|---|---|
| V-1 | High (breaks the lock guarantee for locked pots with Earn on; owner only, no third-party loss) | `vault/src/lib.rs` `on_earn_off_quote` (~970–1006), `core.rs` `earn_value` / `begin_earn_off` (~369–403) | `earn_off` reads the vault's real lending balance before any withdrawal, and nothing stops several `earn_off` calls from overlapping. Each later callback uses the old, larger balance with an already-reduced principal total, so it values the pot's share too high and reduces its principal too little. An owner who sends many small `earn_off` calls for an unlocked pot in the same few blocks can withdraw more than that pot's share, and the excess comes out of other pots' Earn positions, including **locked** pots. Example: unlocked A and locked L each supplied 100; two overlapping `earn_off(A, 50)` leave L's claim worth about 89. | Not fixed (contract). Fix: allow one `earn_off` per token at a time (set a flag in `earn_off`, clear it in `on_earn_off_started`), or refuse while `pending_returns` for the token is non-empty |
| V-2 | Medium | `core.rs` `credit` (~266–302), `lib.rs` `on_earn_off_started` (~1008–1025) | `pending_returns` records the amount asked for. Rhea's `execute` finishes before its token transfer, `Withdraw` takes at most what is available, and a failed transfer is re-deposited inside Rhea. If less than asked arrives, the rest stays pending with no expiry or cancel, and **later incoming payments** of that token go to that pot (FIFO) instead of through the plan. If that pot is locked, the incoming money becomes locked | Not fixed (contract). Fix: credit the measured balance change and clear the pending entry, or add an owner method to drop stale pending returns |
| V-3 | Medium (design) | `common/src/lib.rs` `APP_KEY_METHODS`; `lib.rs` `approve_proposal` (~414), `run_action` (~1367), `add_agent` (~364) | The large-withdrawal threshold only applies to `withdraw`. With the app key, `add_agent` (any caps) or approving a `pay` proposal moves any amount of unlocked money without the owner key | Documented (section 2, 6). Fix in a future vault version: apply the threshold to proposal and agent payouts, or move `add_agent` off the app key |
| V-4 | Medium (ops) | testnet accounts | `oiko.testnet`, `ajo.oiko.testnet`, `lending.oiko.testnet`, `usdc.oiko.testnet` have full-access keys (verified with RPC). The ROSCA savings contract holds members' contributions and bonds | Not fixed. Delete the keys once the deployment is verified, and add that step to the deploy script |
| A-1 | Medium | `ajo/src/lib.rs` `create_circle`, `start` (~202–238), `ft_on_transfer` bond branch (~277–294) | A circle that never starts (organiser never starts it, or the bonded-positions rule can't be met) has no cancel or refund. Bonds posted while forming are stuck. Members cannot leave | Not fixed (contract) |
| A-2 | Low | `ajo/src/lib.rs` `join` (~181–200) | The invite code is sent in plain text in the first `join` transaction, and its hash is in contract state (readable with `view_state`), so short codes can be guessed offline. Anyone with the code can join and the organiser cannot remove members | Not fixed. App should use long random codes |
| A-3 | Low (design) | `ajo/src/lib.rs` `settle_round` (~316–334) | A member who misses rounds before their turn still receives the full pot on their turn; bonds only cover members who already received the pot | Documented |
| R-1 | Low | `registry/src/lib.rs` `valid_name` (~78), `account_for` (~303) | `valid_name` accepts names that are not valid NEAR account labels (`a_`, `-ab`, `a__b`). `is_available` says yes and `register_name` panics on an `unwrap` instead of `E_BAD_NAME` | Fixed on the server side: `NAME_RE` in `packages/sdk/src/config.ts` now requires a valid label, so `/api/names`, `/api/register` and the relayer refuse these names |
| R-2 | Info | `registry/src/lib.rs` `suggest` (~235) | Suggestions include a country-specific `_ng` suffix | Not fixed (contract). The UI can filter suggestions |
| S-1 | Low (mainnet: Medium) | `relayer.ts` `registerName`, `topup`; `http.ts` `clientIp` | Each registration gives a new account 1.5 NEAR that its full-access key can move out, and `topup` refills any Oiko account below the threshold (3 a day per account). Only per-instance limits keyed on a client-supplied IP header, plus the daily budget, limit this | Documented. Mainnet needs stronger gating (proof of personhood, captcha, or a smaller sponsored amount) |
| S-2 | Low | `app/api/mock-1click/v0/quote`, `.../deposit/submit` | Unauthenticated mock endpoints had no rate limit, and each submit makes the relayer mint and sync | **Fixed**: same per-IP limits as `intents` and `simulate` |
| S-3 | Low | `agentHttp.ts` (`agentRead`, `agentWrite` `finally`), `mcp.ts` `catch` | Failed requests are written to the access log under the vault and key named in the **unverified** header, so anyone can add rows (with error status) to any vault's log | Not fixed (changes log semantics). Suggest logging only after the signature verifies, or marking unverified rows |
| S-4 | Low (test mode only) | `mock1click.ts` `mockSubmitDeposit` (~430–458) | Without `DATABASE_URL`, a quote ticket that was never submitted can be submitted again on a different serverless instance, which mints test tokens again. Test mode also mints any quoted amount, by design | Documented. Set `DATABASE_URL` on the hosted demo |
| S-5 | Low | `mock1click.ts` `relayerMinter` (~367–379) | The mock mint transaction is not counted in the relayer's daily budget (the sync after it is) | Not fixed |
| V-9 | Info (unverified) | `lib.rs` `GAS_CB` = 15 Tgas for `on_balance` | With the maximum configuration (20 split rules → up to 22 activity rows per deposit) the credit callback may run out of gas. Then every `sync` fails the same way and deposits stay uncredited (not lost). Not measured | Add a sandbox test at the maximum configuration |

No authentication bypass was found in the gateway, no cap or allowlist bypass for agents, no way around a lock with `move_funds`, `withdraw`, `withdraw_large`, `pay_bill`, agent actions or proposals, and no relay allow-list shape that lets the relayer pay for anything other than creating the sender's own vault with trusted code.

## 8. Known limitations

- **No audit.** The contracts are a hackathon build.
- **Testnet uses mock tokens and mock lending.** `usdc.oiko.testnet` and `usdt.oiko.testnet` are mock NEP-141 tokens minted by the relayer; `lending.oiko.testnet` mirrors Rhea's method names and shapes. NEAR Intents has no testnet, so payments from other chains are simulated with the real 1Click request and response shapes.
- **In-memory server state without `DATABASE_URL`**: nonces, access log, push subscriptions and mock swaps are per instance and reset on restart.
- **Agent cross-chain payouts are proposal-only.**
- **Test-mode ticket double simulate** (S-4).
- **Rate limits are per instance** and trust the forwarded IP header.
- **Earn** carries the risks in V-1 and V-2 and Rhea's own risk.
- **Testnet contract accounts are not yet keyless** (V-4).
- `rescue_sign` (chain signatures for funds sent on the wrong chain) checks its inputs in tests but has not been run against the MPC signer.
