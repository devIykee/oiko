# Frozen contract interfaces (v1.0.0)

All amounts are `U128` decimal strings in token base units (6 decimals for USDC and USDT).
All times are `U64` decimal strings in nanoseconds (`env::block_timestamp()`).
`Token` is the string `"usdc"` or `"usdt"`. Token contract ids are fixed at init.
Accounts below use the root `<root>` (testnet: `oiko.testnet`, local: `oiko.test.near`, mainnet: configurable `OIKO_ROOT_ACCOUNT`).

Error strings: every `require!`/panic message starts with a stable code, e.g. `E_LOCKED: pot is locked until <ns>`. The UI maps codes to plain English (see `packages/sdk/src/errors.ts`).

## Events (NEP-297)

Log line: `EVENT_JSON:{"standard":"oiko","version":"1.0.0","event":"<name>","data":[{...}]}`

| event | data fields |
|---|---|
| `name_registered` | name, account_id, owner_public_key |
| `vault_created` | vault_id, owner |
| `pot_created` / `pot_updated` / `pot_deleted` | pot_id, name, kind |
| `splits_updated` | rules |
| `deposit_received` | token, amount, source ("sync" \| "ft_on_transfer"), sender_id? |
| `split_applied` | token, amount, allocations: [{pot_id, amount}] |
| `moved` | from_pot, to_pot, token, amount, by ("owner" \| "agent:<pk>" \| "schedule" \| "proposal:<id>") |
| `withdrawn` | pot_id, token, amount, to, by |
| `locked` / `lock_extended` | pot_id, unlock_at |
| `earn_supplied` / `earn_withdrawn` / `earn_refused` | pot_id, token, amount, utilization_bps? |
| `agent_added` / `agent_revoked` | public_key, agent_name |
| `agent_action` | public_key, action, amount, token, recipient?, remaining_day, remaining_week |
| `agent_cap_warning` | public_key, window ("day" \| "week"), used, cap |
| `agent_proposal` | id, public_key, action, reason |
| `proposal_approved` / `proposal_rejected` | id |
| `schedule_added` / `schedule_removed` / `schedule_ran` | schedule_id, ... |
| `bill_added` / `bill_removed` / `bill_paid` | bill_id, name, amount, token, payee, period, by |
| `ajo_*` (ajo contract) | circle_id, ... |

## Vault (`vault.<name>.<root>`, keyless, immutable, no upgrade method)

### Types (JSON)

```jsonc
Balances   { "usdc": U128, "usdt": U128 }
PotKind    "flex" | "autosave" | "locked" | "goal" | "bills"       // UI: flex = "Spend", autosave = "Savings"
Pot {
  "id": u32, "name": string, "icon": string, "color": string, "kind": PotKind,
  "balances": Balances,            // funds held in the vault for this pot
  "earn_supplied": Balances,       // funds of this pot currently supplied to lending
  "unlock_at": U64 | null,         // outflows refused while now < unlock_at
  "target": U128 | null, "target_date": U64 | null,
  "earn": bool, "created_at": U64
}
SplitRule  { "pot_id": u32, "mode": "percent" | "fixed", "value": U128 }   // percent: value = bps (0..=10000)
Recipient  { "type": "near", "account_id": AccountId }
           | { "type": "intents", "chain": string, "address": string, "token": Token }   // proposal-only, never executable by an agent directly
Scope      "read" | "propose" | "act"
AgentKind  "pay" | "move_between_pots" | "save"
AgentAction
  { "type": "pay",  "token": Token, "amount": U128, "to": AccountId, "memo": string | null }        // from flex
  { "type": "pay_bill", "bill_id": u32 }                                                            // from bill.pot_id, counts as "pay"
  { "type": "move", "from_pot": u32, "to_pot": u32, "token": Token, "amount": U128 }               // counts as "move_between_pots"
  { "type": "save", "to_pot": u32, "token": Token, "amount": U128 }                                // flex -> pot, counts as "save"
AgentPolicy {
  "label": string, "agent_name": string, "agent_url": string,
  "scopes": [Scope], "allowed_actions": [AgentKind], "allowlist": [Recipient],
  "per_tx": U128, "daily": U128, "weekly": U128,      // per token-agnostic unit (USDC+USDT summed, 6 decimals)
  "expires_at": U64,
  "spent_day": [u64 day_index, U128], "spent_week": [u64 week_index, U128],   // read-only
  "revoked": bool, "created_at": U64
}
AgentView  = AgentPolicy + { "public_key": PublicKey }
Proposal { "id": u64, "public_key": PublicKey, "agent_name": string, "action": AgentAction,
           "reason": string (<=280), "created_at": U64, "expires_at": U64,
           "status": "pending" | "approved" | "rejected" | "expired" }
Schedule { "id": u32, "to_pot": u32, "token": Token, "amount": U128, "period_ns": U64, "next_run": U64 }
Bill { "id": u32, "name": string, "amount": U128, "token": Token, "due_day": u8 (1..=28),
       "payee": AccountId, "pot_id": u32, "last_paid_month": u32 | null (yyyymm), "created_at": U64 }
Activity { "seq": u64, "at": U64, "kind": string (event name), "by": string,
           "token": Token | null, "amount": U128 | null, "pot_id": u32 | null,
           "counterparty": string | null, "note": string | null }
MonthStats { "month": u32 (yyyymm), "in": Balances, "out": Balances, "saved": Balances }
Overview {
  "owner": AccountId, "tokens": {"usdc": AccountId, "usdt": AccountId},
  "pots": [Pot], "splits": [SplitRule], "totals": Balances, "flex": Balances,
  "locked": Balances, "earning": Balances, "agents": [AgentView], "proposals": [Proposal] (pending only),
  "schedules": [Schedule], "bills": [Bill], "config": Config, "accounted": Balances, "now": U64
}
Config { "max_utilization_bps": u16, "large_withdrawal_threshold": U128, "lending": AccountId | null,
         "ajo": AccountId | null, "mpc_signer": AccountId | null, "agent_allowance": U128 (yocto) }
```

### Init

`new(owner: AccountId, usdc: AccountId, usdt: AccountId, config: Config)` — creates the Spend (flex) pot with id 0. Then the vault calls `storage_deposit` for itself on usdc, usdt (and lending if set), paying from its own NEAR balance.

### Owner-only (predecessor == owner). No method needs an attached deposit (so a function-call key can call them), except where noted.

- `create_pot(name, icon, color, kind, target?, target_date?) -> u32`
- `update_pot(pot_id, name?, icon?, color?, target?, target_date?)`
- `delete_pot(pot_id)` — balances and earn_supplied must be 0; flex undeletable; removes split rules for it.
- `set_splits(rules: [SplitRule])` — percent total ≤ 10000; pot ids exist; flex not allowed as a target.
- `move_funds(from_pot, to_pot, token, amount)` — refused if from_pot locked (`E_LOCKED`).
- `lock(pot_id, unlock_at)` — pot must not be flex; sets unlock_at if none or new ≥ current. `extend_lock(pot_id, new_unlock_at)` — new ≥ current. No shorten/break method exists.
- `withdraw(pot_id, token, amount, to: AccountId, memo?)` — amount ≤ large_withdrawal_threshold, else `E_LARGE`. Refused if locked. Uses `ft_transfer` (vault attaches 1 yocto from its own balance). Callback restores on failure.
- `withdraw_large(pot_id, token, amount, to, memo?)` — same, no threshold. Excluded from the app's function-call key, so it needs the full-access login key.
- `earn_on(pot_id, token, amount)` / `earn_off(pot_id, token, amount)` — flex refused (`E_FLEX_EARN`). Guard: view lending asset → utilization = borrowed/supplied; refuse if > max_utilization_bps (emits `earn_refused`).
- `add_agent(public_key, policy: AgentPolicyInput)` — AgentPolicyInput = AgentPolicy minus spent_*/revoked/created_at. Validates: per_tx ≤ daily ≤ weekly when `act` granted; expires_at ≤ now + 90 days. Adds a function-call key to the vault itself: receiver = vault, methods = [`agent_execute`, `agent_propose`], allowance = config.agent_allowance.
- `revoke_agent(public_key)` — marks revoked, deletes key.
- `approve_proposal(id)` / `reject_proposal(id)` — approve executes the action with owner authority (locks still apply, allowlist does not).
- `add_schedule(to_pot, token, amount, period_ns, first_run) -> u32`, `remove_schedule(id)`
- `add_bill(name, amount, token, due_day, payee, pot_id) -> u32`, `remove_bill(id)`, `pay_bill(id)`
- `ajo_contribute(circle_id, token, amount)` / `ajo_post_bond(circle_id, token, amount)` — from flex via `ft_transfer_call` to config.ajo.
- `ajo_join(circle_id, invite_code)` — cross-call to ajo `join`, predecessor = vault.
- `rescue_sign(chain: "evm" | "tron", payload: [u8;32] hex) -> Promise` — calls mpc signer `sign` with path `oiko-rescue-v1/<chain>`; the owner attaches the signer deposit (payable; this is the one method needing the full-access key).

### Agent-only (signer_account_pk must be a registered, non-revoked agent key; predecessor == current account)

- `agent_execute(action: AgentAction)` — checks scope `act`, not revoked, not expired, kind allowed, recipient on allowlist (near only), amount ≤ per_tx, day/week windows (day = ts / 86400e9, week = ts / 604800e9). Emits `agent_action`, and `agent_cap_warning` when a window crosses 80%.
- `agent_propose(action: AgentAction, reason: string) -> u64` — scope `propose`; max 20 pending per agent; expires after 7 days.

### Permissionless

- `sync()` — for each token: `ft_balance_of(vault)` → callback: `delta = real_balance - accounted`; if delta > 0, apply splits and add to accounted. Invariant: `accounted[t] == Σ pots.balances[t] + in_flight[t]` and `Σ earn_supplied` is tracked separately (supplied funds are not in ft balance). Calling twice changes nothing.
- `ft_on_transfer(sender_id, amount, msg) -> U128("0")` — only from usdc/usdt; applies splits immediately (msg ignored, except `"lending_return"`, which credits back to pending earn_off).
- `run_schedules()` — executes each due schedule once per period (skips if flex too low).

### Views

`get_overview() -> Overview`, `get_pot(pot_id)`, `get_splits()`, `get_agents()`, `get_agent(public_key)`, `get_proposals(include_closed: bool)`, `get_activity(from_seq: u64 | null, limit: u32) -> [Activity]` (newest first, ring buffer of the last 200), `get_month_stats(from_month, to_month) -> [MonthStats]`, `get_bills()`, `get_rescue_path(chain) -> string`, `version() -> "1.0.0"`.

## Registry (`<root>`, keyless after deployment, no upgrade method)

- `new(vault_code_hash: Base58CryptoHash | null, usdc, usdt, lending: AccountId | null, ajo: AccountId | null, mpc_signer: AccountId | null, relayer: AccountId, account_funding: U128)`
- `register_name(name, owner_public_key: PublicKey, app_public_key: PublicKey)` — payable; only `relayer` may call; attached deposit ≥ account_funding. Validates name `^[a-z0-9_-]{2,32}$`, not reserved, available. Creates `<name>.<root>` with: full-access key `owner_public_key`; function-call key `app_public_key` (receiver `vault.<name>.<root>`, every owner method except `withdraw_large` and `rescue_sign`, allowance 0.25 NEAR). Transfers `account_funding`. Callback refunds on failure. Emits `name_registered`.
- `is_available(name) -> bool`, `suggest(name) -> [string; 3]`, `get_name(name) -> {account_id, vault_id, created_at} | null`
- `vault_code_hash()`, `trusted_code_hashes() -> [string]`, `config() -> {...}`, `stats() -> { names: u64 }`

Vault creation (after `register_name`, signed by the user's full-access key, sent as a NEP-366 delegate action through the relayer):
`CreateAccount(vault.<name>.<root>)` → `Transfer(vault_funding)` → `UseGlobalContract(code_hash)` (fallback `DeployContract(wasm)`) → `FunctionCall new(...)`. No `AddKey`.

## Ajo (`ajo.<root>`, keyless, immutable)

```jsonc
Circle { "id": u64, "name": string, "organiser": AccountId, "token": Token, "amount_per_round": U128,
  "period_ns": U64, "max_members": u8, "members": [AccountId], "order": [AccountId],
  "bond_amount": U128, "bonds": {AccountId: U128}, "start_at": U64 | null, "round": u32,
  "paid": [[u32, AccountId]], "defaults": [[u32, AccountId]], "collected": U128,
  "status": "forming" | "active" | "completed", "shuffle": bool, "payouts": [[u32, AccountId, U128]] }
```

- `create_circle(name, token, amount_per_round, period_ns, max_members, bond_amount: U128 | null, shuffle: bool, invite_code_hash: string(hex sha256)) -> u64` — caller (a vault) becomes first member. `period_ns` ≥ MIN_PERIOD (60 s with feature `short-periods`, else 1 day).
- `join(circle_id, invite_code)` — sha256(invite_code) must match.
- `start(circle_id)` — organiser only; ≥ 2 members; fixes `order` (join order or shuffle with `env::random_seed()`); members in the first half of the order must have posted bonds.
- `ft_on_transfer(sender_id, amount, msg)` — msg `{"circle_id":n,"kind":"contribution"|"bond"}`; contribution must equal amount_per_round for the current round; returns unused amount.
- `settle_round(circle_id)` — permissionless after `start_at + (round+1)*period`: pays the round's recipient what was collected (ft_transfer_call to the recipient vault), records defaults, covers an already-paid defaulter's missed amount from their bond. After the last round: returns remaining bonds, status completed.
- Views: `get_circle(id)`, `get_circles_for(member) -> [Circle]`, `get_circles(from, limit)`.
- No withdraw or admin method exists.

## Mocks

- `mock-ft` (`usdc.<root>`, `usdt.<root>`): NEP-141 + NEP-145 + NEP-148, 6 decimals; `mint(account_id, amount)` callable only by the `minter` set at init (the faucet/relayer account).
- `mock-lending` (`lending.<root>`): mirrors the verified Rhea/Burrow method names and JSON shapes (see DECISIONS.md), plus `set_state(token_id, supplied, borrowed, apy_bps)` callable by its `admin` (test-only contract).
