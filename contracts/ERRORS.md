# Oiko contract error codes

Every panic message starts with `CODE: detail`. Codes marked *(log)* are not panics: the call
succeeds and the code is written to the logs next to an event, so the UI should look for them there.

## Vault

| Code | Meaning |
|---|---|
| `E_NOT_OWNER` | Only the account owner can do this. |
| `E_BAD_ARGS` | The call's arguments were malformed (bad JSON, a missing field or a wrong type). |
| `E_BAD_INIT` | The vault can only be set up by its owner, on `vault.<owner>`. |
| `E_BAD_CONFIG` | A setting is out of range (for example utilization above 95%, or a zero agent allowance). |
| `E_BAD_INPUT` | A name, label or other field is empty, too long or doesn't make sense. |
| `E_BAD_AMOUNT` | The amount must be more than zero. |
| `E_OVERFLOW` | The amount is too large to handle. |
| `E_NO_POT` | That pot doesn't exist. |
| `E_FLEX` | Spend is special: there is only one, and it can't be deleted, locked or targeted by your plan. |
| `E_POT_NOT_EMPTY` | Move or withdraw everything (including Earn) before deleting this pot. |
| `E_POT_IN_USE` | A bill or schedule still uses this pot. Remove it first. |
| `E_TOO_MANY` | You've reached the limit (20 pots, 10 agents, 20 schedules or 30 bills). |
| `E_BAD_SPLITS` | Your plan is invalid: percentages over 100%, a missing pot, a zero rule, or Spend as a target. |
| `E_INSUFFICIENT` | Not enough money in that pot. |
| `E_LOCKED` | This pot is locked until its unlock date. Nobody can move money out before then. |
| `E_LOCK_SHORTEN` | Locks can be extended but never shortened. |
| `E_NOT_LOCKED` | This pot has no lock to extend. |
| `E_BAD_TIME` | The unlock date must be in the future. |
| `E_LARGE` | Above your quick-withdraw limit (a withdrawal, an approved payment, or an agent's weekly cap); confirm it with your login key (`withdraw_large`, `approve_proposal_large`, `add_agent_large`). |
| `E_TRANSFER_FAILED` *(log)* | The token transfer failed (for example the receiver can't hold this token); the money went back to the pot. |
| `E_FLEX_EARN` | Spend can't earn; move money to another pot first. |
| `E_NO_LENDING` | Earn isn't available for this account. |
| `E_LENDING` | The lending market couldn't be read or the withdrawal failed; nothing changed. |
| `E_EARN_BUSY` | An Earn change for this token is still finishing; try again in a few seconds. |
| `E_UTILIZATION` *(log + `earn_refused` event)* | The lending market is too heavily borrowed right now, so Earn was refused to keep your money withdrawable. |
| `E_NO_AGENT` | No agent with that key. |
| `E_AGENT_EXISTS` | That key is already a connected agent. |
| `E_BAD_POLICY` | Agent limits are invalid: caps must be per-transaction ≤ daily ≤ weekly, expiry within 90 days. |
| `E_NOT_SELF` | Agent actions must be signed with the agent's own key. |
| `E_NOT_AGENT` | The signing key isn't a connected agent. |
| `E_AGENT_REVOKED` | This agent was disconnected. |
| `E_AGENT_EXPIRED` | This agent's access has expired. |
| `E_SCOPE` | The agent doesn't have permission for this (read, propose or act). |
| `E_ACTION_NOT_ALLOWED` | The agent isn't allowed to do this kind of action. |
| `E_NOT_ALLOWLISTED` | The agent can only pay people on its allowlist. |
| `E_CAP_PER_TX` | Above the agent's per-payment limit. |
| `E_CAP_DAY` | This would go over the agent's daily limit. |
| `E_CAP_WEEK` | This would go over the agent's weekly limit. |
| `E_REASON_TOO_LONG` | The proposal reason must be 280 characters or fewer. |
| `E_TOO_MANY_PROPOSALS` | This agent already has 20 suggestions waiting. |
| `E_NO_PROPOSAL` | That suggestion doesn't exist. |
| `E_PROPOSAL_CLOSED` | That suggestion was already approved or declined. |
| `E_PROPOSAL_EXPIRED` | That suggestion expired (after 7 days). |
| `E_NO_SCHEDULE` | That schedule doesn't exist. |
| `E_BAD_PERIOD` | Repeats must be at least 60 seconds apart (vault schedules) or longer than the ajo minimum. |
| `E_NO_BILL` | That bill doesn't exist. |
| `E_BAD_DUE_DAY` | Due day must be between 1 and 28. |
| `E_BILL_PAID` | This bill is already paid for this month. |
| `E_NO_AJO` | Ajo isn't available for this account. |
| `E_BAD_TOKEN` | Only USDC and USDT can be received. |
| `E_NO_MPC` | Rescue isn't available for this account. |
| `E_BAD_CHAIN` | Rescue supports EVM chains and TRON only. |
| `E_BAD_PAYLOAD` | The rescue payload must be a 32-byte hex hash. |
| `E_DEPOSIT` | Attach the required deposit (rescue: the signer fee; registry: the account funding). |
| `E_GAS` | Not enough gas attached (rescue needs at least 70 TGas). |

## Registry

| Code | Meaning |
|---|---|
| `E_NOT_RELAYER` | Only the Oiko relayer can register names. |
| `E_BAD_NAME` | Names are 2–32 characters: a–z, 0–9, `_` and `-`, not at the start or end and not doubled. |
| `E_RESERVED` | That name is reserved. |
| `E_TAKEN` | That name is taken. |
| `E_CREATE_FAILED` *(log)* | The account couldn't be created; the deposit was refunded. |

## Ajo

| Code | Meaning |
|---|---|
| `E_NO_CIRCLE` | That circle doesn't exist. |
| `E_NOT_ORGANISER` | Only the organiser can do this (start, cancel early, remove a member, change the invite); the organiser cancels instead of leaving. |
| `E_NOT_FORMING` | The circle has already started (or was cancelled). |
| `E_NOT_ACTIVE` | The circle isn't running. |
| `E_ALREADY_MEMBER` | You're already in this circle. |
| `E_FULL` | The circle is full. |
| `E_BAD_INVITE` | The invite code is wrong (codes are at least 10 characters). |
| `E_NOT_MEMBER` | Only members can pay into this circle. |
| `E_TOO_FEW` | A circle needs at least 2 members. |
| `E_BOND_MISSING` | Members who collect early must post their bond before the circle starts. |
| `E_TOO_EARLY` | This round hasn't ended yet. |
| `E_BAD_MSG` | The transfer message must say which circle and whether it's a contribution or a bond. |
| `E_TOO_LATE` *(log, refunded)* | This round already ended; your payment was returned. |
| `E_ALREADY_PAID` *(log, refunded)* | You already paid this round (or posted your bond); the extra was returned. |
| `E_NO_BOND` *(log, refunded)* | This circle doesn't take a bond now; the payment was returned. |

`E_BAD_AMOUNT`, `E_BAD_INPUT`, `E_BAD_PERIOD`, `E_BAD_TOKEN` also apply to ajo with the same meaning
(ajo logs `E_BAD_AMOUNT` and refunds when a contribution or bond is short).

## Mocks (sandbox/testnet only)

| Code | Meaning |
|---|---|
| `E_NOT_MINTER` | Only the faucet can mint test tokens. |
| `E_NOT_ADMIN` | Only the admin can change the mock lending market. |
