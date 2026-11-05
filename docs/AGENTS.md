# Building an agent for Oiko

Oiko has no built-in AI. A person connects the agent they already use, and that agent can read their account, suggest money moves, and (if they allow it) move money inside limits the account's contract enforces. This guide covers what an agent can do, how to connect, every tool, and the errors you will see.

Hosted demo (NEAR testnet, test tokens): https://oikodotnear.vercel.app. Machine-readable versions of this guide: `/llms.txt`, `/.well-known/oiko-agent.json`, `/openapi.json`.

## Concepts

- **Account.** Each person has an identity account `<name>.<root>` and a money account `vault.<name>.<root>` (testnet root: `oiko.testnet`). Agents only ever touch the vault. In API fields the vault id is called `vault` or `accountId`.
- **Agent key.** An ed25519 key the owner adds to their vault with `add_agent`. On NEAR it is a function-call key that can only call `agent_execute` and `agent_propose` on the vault, with a small NEAR allowance for gas. You hold the secret key; Oiko never sees it unless the owner generated it for you in the browser (connection string).
- **Scopes.** `read` (gateway reads), `propose` (`agent_propose`: suggest an action, the owner approves or rejects it in the app), `act` (`agent_execute`: do it now, within limits).
- **Allowed actions.** `pay` (also covers `pay_bill`), `move_between_pots` (`move`), `save` (Spend → another pot).
- **Allowlist.** NEAR accounts this agent may pay. `pay_bill` checks the bill's payee.
- **Caps.** `per_tx`, `daily` (UTC day), `weekly`, in base units with USDC and USDT added together. Every executed action counts, moves included.
- **Expiry.** At most 90 days. The owner can revoke at any time; revoking deletes the key, and reads stop working too.
- **Proposals.** Up to 20 pending per agent, expire after 7 days. An approved proposal runs with the owner's authority: locks still apply, your allowlist and caps do not. Paying to another chain is proposal-only.
- **Pots.** Spend (`kind: flex`, id 0) is the only pot you can pay from. Locked pots refuse every outflow before their date, for everyone.
- **Amounts.** Integer strings in base units, 6 decimals: `"1500000"` = 1.50. Reads also give `{ units, token, display }`. Always write amounts as number + ticker ("120.50 USDT").

The contract enforces scopes, kinds, allowlist, caps, expiry and revocation. The gateway checks scopes and that your key exists, but it never pre-checks caps.

## Connect

### A. Owner-issued connection string (simplest)
In the app: Agents → Connect → pick a template or set limits → copy the one-time string `oiko1:<base64url(JSON {api, vault, sk})>`. It contains the agent's **secret key**, so treat it like a password. It is shown once, as text and a QR code.

### B. Agent-initiated link (`/connect`)
Generate your own ed25519 key pair, keep the secret, and send the owner a link:

```
https://oikodotnear.vercel.app/connect?name=<agent name>&url=<https agent site>&pk=ed25519:<public key>
  &scopes=read,propose,act&actions=pay,save,move_between_pots&allow=landlord.testnet,shop.testnet
  &per_tx=20&daily=50&weekly=200&days=30&callback=<https url>
```

| Param | Meaning |
|---|---|
| `pk` | Required. `ed25519:` + base58 public key (43–44 chars). Without it the page shows "bad link" |
| `name` | Agent name shown to the owner (first 40 characters) |
| `url` | Your site, shown with a warning that Oiko cannot verify who runs an agent |
| `scopes` | Comma list of `read`, `propose`, `act`. Default `read` |
| `actions` | Comma list of `pay`, `move_between_pots`, `save` |
| `allow` | Comma list of NEAR accounts you may pay |
| `per_tx`, `daily`, `weekly` | **Plain amounts** (20 = 20 USDC + USDT), not base units. Left out: the shared defaults **40 / 50 / 100** (`DEFAULT_CAPS` in `@oiko/sdk`, the same values the app's templates start from). The consent screen always shows the exact caps that will be written to the contract |
| `days` | Lifetime in days, 1–90 (default 30) |
| `callback` | Optional, `https://` only. After approval the owner gets a button back to it with `?vault=<vault id>` appended |

The owner reviews everything in plain words and can change any limit before approving. After approval, your `accountId` is the vault id from the callback (or ask the owner for their name: the vault is `vault.<name>.<root>`).

### C. MCP over stdio (`oiko-mcp`)
The stdio server signs every request and transaction locally with your key.

```bash
# from this repo (the package is not on the npm registry yet)
pnpm install && pnpm --filter oiko-mcp build
OIKO_CONNECTION='oiko1:…' node packages/mcp/bin/oiko-mcp.mjs
# or: OIKO_AGENT_KEY=ed25519:<secret> OIKO_VAULT_ID=vault.ada.oiko.testnet OIKO_API_URL=https://oikodotnear.vercel.app
```

Claude Desktop (`claude_desktop_config.json`, see `examples/agents/claude-desktop.json`). Once `oiko-mcp` is published, `"command": "npx", "args": ["-y", "oiko-mcp"]` works; until then point at the local build:

```json
{
  "mcpServers": {
    "oiko": {
      "command": "node",
      "args": ["/absolute/path/to/oiko/packages/mcp/bin/oiko-mcp.mjs"],
      "env": { "OIKO_CONNECTION": "oiko1:paste-the-connection-string-from-Oiko-Agents-Connect" }
    }
  }
}
```

### D. MCP over HTTP
`POST https://oikodotnear.vercel.app/api/mcp` — streamable HTTP, stateless, JSON responses. **Every** POST (initialize, tools/list, tools/call) needs its own NEP-413 header (below), signed over that request's exact body. GET returns 405. The HTTP server cannot sign: `propose` and `act` first return `{ needs_signature: true, unsigned_tx, hash, how }`; sign it and call the same tool again with `signed_tx`.

### E. REST
Base `https://oikodotnear.vercel.app/api/agent`. Same header. See "Moving money over REST" below.

## Hosted agents (no install): session tokens

For assistants that run in the cloud and can't run `npx` or sign each request (Grok, ChatGPT, Claude.ai custom connectors).

1. The owner opens **Agents → Connect a hosted agent**, picks what it may do and approves. The browser makes the agent key; it never leaves the page and the server never holds it.
2. The browser signs one request with that key: `POST /api/agent/session` with the usual NEP-413 `Authorization` header and body `{"ttl_hours": 1..24}`. The response is `{ token, expires_at, vault, public_key, scopes }`.
3. The assistant uses either `https://<host>/api/mcp/t/<token>` (for clients that only take a URL) or `https://<host>/api/mcp` with `Authorization: Bearer <token>`.

Limits, honestly:

- **Reads work fully.** That covers balances, pots, plan, bills, activity, insights and the agent's own caps.
- **`propose` and `act` still need the agent's own signature.** Without `signed_tx` the tools return the unsigned transaction and how to sign it. A hosted assistant normally can't sign, so in practice a hosted link is read-only plus explanations. Agents that can sign should use the MCP package or the HTTP gateway with NEP-413.
- **Tokens last at most 24 hours** and never longer than the agent's own expiry. Every request re-checks the key on the vault (`view_access_key`) and the agent policy. **Disconnect**, which deletes the key, ends the session on the next request. `DELETE /api/agent/session` with the bearer token ends just that session.
- **A token in a URL can end up in logs.** Treat the link like a password and prefer the header form when the client supports it.

## Authentication (NEP-413), exact format

```
Authorization: NEP413 <base64( JSON { accountId, publicKey, signature, nonce, message } )>
```

- `accountId`: the vault, e.g. `vault.ada.oiko.testnet`.
- `publicKey`: `ed25519:<base58>`.
- `message`: three lines joined by `\n`:
  ```
  <METHOD> <path including query string>
  <sha256 hex of the exact request body; sha256("") for GET>
  <unix time in milliseconds>
  ```
  Example: `GET /api/agent/activity?limit=5\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n1793361600000`
- NEP-413 payload signed: `{ message, nonce, recipient: "oiko-gateway" }` (no callbackUrl). Per NEP-413 the signed bytes are `sha256( u32_le(2^31 + 413) ‖ borsh({ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> }) )`.
- `nonce`: 32 random bytes, base64, never reused. `signature`: 64-byte ed25519 signature, base64.
- Refused when: method or path differ from the request, body hash differs, timestamp is more than 5 minutes off, nonce reused, signature invalid, key no longer on the vault, agent unknown, revoked or expired, or the scope is missing.

With the SDK: `gatewayAuthHeader(secretKey, vaultId, method, path, body)` from `@oiko/sdk` builds the header; `GatewayClient` signs every request for you.

## Tools

MCP tool names (stdio and HTTP) and the matching REST paths. All reads need the `read` scope. Money values are `{ units, token, display }`; balances are `{ usdc, usdt, total }`.

| MCP tool | REST | Input | Output (main fields) |
|---|---|---|---|
| — | `GET /api/agent/me` | — | `vault, public_key, label, agent_name, scopes, allowed_actions, allowlist, expires_at, caps: { per_tx, day: {cap, used, remaining}, week: {…} }` |
| `get_overview` | `GET /api/agent/overview` | — | `owner, totals, spend_available, locked, earning, pots[], goals[], splits[], bills[], my_pending_proposals[], my_caps` |
| `get_pots` | `GET /api/agent/pots` | — | `pots[]: { id, name, kind, kind_label, balances, earning, locked_until, target, target_date, earn }` |
| `get_activity` | `GET /api/agent/activity?limit=` | `limit` 1–100 (default 20) | `activity[]`, newest first: `{ seq, at, at_iso, kind, by, token, amount, pot_id, counterparty, note, display }`. `by` is `owner`, `agent:<key>`, `schedule` or `proposal:<id>` |
| `get_goals` | `GET /api/agent/goals` | — | `goals[]`: pot fields + `eta` (ISO or null) + `assumption` |
| `get_splits` | `GET /api/agent/splits` | — | `rules[]: { pot_id, mode: percent\|fixed, value, pot_name }` (percent in basis points), `preview_for_100[]` |
| `get_bills` | `GET /api/agent/bills` | — | `bills[]: { id, name, amount, due_day, payee, pot_id, last_paid_month, status: upcoming\|due\|paid\|missed, next_due }` |
| `get_insights` | `GET /api/agent/insights?month=yyyymm` | `month` (optional, UTC) | `month, money_in, money_out, saved, savings_rate_bps, top_payees[], trend[]` |
| `get_earn_rates` | `GET /api/agent/earn-rates` | — | `source, fetchedAt, assets[]: { token, supplyApr (percent string), utilizationBps, paused }` |
| `get_rosca_groups` | `GET /api/agent/rosca` (`/api/agent/ajo` is an old alias) | — | `groups[]` (and the same list as `circles[]`): ROSCA savings groups with members, payout order, round, paid, defaults, bonds |
| `get_invoices` | `GET /api/agent/invoices` | — | `invoices[]`: the owner's invoices (number, client, items, total, due date, status draft/open/pending/paid/refunded/cancelled/overdue, received after fees, transaction links). Read only: agents cannot create, edit or cancel invoices |
| `propose` | prepare + submit with `kind: "propose"` | `action`, `reason` (1–280 chars), `signed_tx` (HTTP only) | stdio: `{ ok, txHash, proposalId, note }` |
| `act` | prepare + submit with `kind: "act"` | `action`, `reason` (optional, not stored on-chain), `signed_tx` (HTTP only) | stdio: `{ ok, txHash, result }` |

`action` is one of:

```jsonc
{ "type": "pay",      "token": "usdc|usdt", "amount": "2000000", "to": "landlord.testnet", "memo": "Rent" }   // from Spend
{ "type": "pay_bill", "bill_id": 3 }
{ "type": "move",     "from_pot": 2, "to_pot": 0, "token": "usdt", "amount": "5000000" }
{ "type": "save",     "to_pot": 4, "token": "usdc", "amount": "10000000" }                                    // Spend -> pot
```

MCP errors come back as `isError: true` with text `{ "error": { "code", "message" } }`.

### Moving money over REST

1. `POST /api/agent/prepare` with body `{ "kind": "act" | "propose", "action": {…}, "reason": "…" }` (reason required for `propose`). Response: `{ unsignedTx, hash }` — base64 borsh `Transaction` (signer and receiver = the vault, your key, one function call, 100 Tgas, no deposit) and base64 `sha256` of those bytes.
2. Sign `hash` with your ed25519 key and build a borsh `SignedTransaction`, base64-encoded (`signTransactionBytes(secretKey, bytes)` in `@oiko/sdk` does both).
3. `POST /api/agent/submit` with `{ "signedTx": "…" }`. Response: `{ txHash, ok: true, value }` or `{ txHash, ok: false, error: { code, message, detail } }`. A refusal by the contract is a normal `200` with `ok: false`.

The gateway accepts only one `agent_execute` or `agent_propose` call with no deposit, signed by the same key that signed the request. `prepare` may top up the vault's NEAR for gas from the Oiko relayer (rate limited, best effort).

## Errors

Gateway (HTTP status, `{ error: { code, message } }`):

| Code | Status | Meaning |
|---|---|---|
| `E_AUTH` | 401/403 | Header missing or malformed, wrong path/method/body hash, bad signature, wrong `accountId`, or a submitted transaction that isn't yours |
| `E_STALE` | 401 | Timestamp more than 5 minutes off |
| `E_REPLAY` | 401 | Nonce already used |
| `E_KEY_GONE` | 401 | The key is no longer on the vault (revoked) |
| `E_AGENT_UNKNOWN` | 403 | Key is not a registered agent |
| `E_AGENT_REVOKED`, `E_AGENT_EXPIRED` | 403 | Disconnected or expired |
| `E_SCOPE` | 403 | Missing `read`, `propose` or `act` |
| `E_BAD_REQUEST` | 400 | Body failed validation |
| `E_RATE_LIMIT` | 429 | Over 120 requests a minute per IP or 60 per key |
| `E_NOT_FOUND` | 404 | Unknown read tool |
| `E_DISABLED` | 404 | MCP over HTTP is turned off on this deployment |

Contract refusals (in `submit` results and MCP errors; full list in `contracts/ERRORS.md`): `E_CAP_PER_TX`, `E_CAP_DAY`, `E_CAP_WEEK`, `E_NOT_ALLOWLISTED`, `E_ACTION_NOT_ALLOWED`, `E_SCOPE`, `E_AGENT_REVOKED`, `E_AGENT_EXPIRED`, `E_LOCKED`, `E_INSUFFICIENT`, `E_NO_POT`, `E_NO_BILL`, `E_BILL_PAID`, `E_BAD_AMOUNT`, `E_BAD_INPUT`, `E_REASON_TOO_LONG`, `E_TOO_MANY_PROPOSALS`, `E_NOT_SELF`, `E_NOT_AGENT`. `E_TRANSFER_FAILED` appears in logs when the token transfer failed and the money went back to Spend (the spend is not counted against your caps).

A refusal is final. Explain it in plain words and, if it makes sense, offer a proposal instead.

## Examples

- **Scripted agent (no LLM):** `examples/agents/scripted`. Reads `me` and `overview`, proposes a save, pays an allowlisted account twice, then tries a third payment that the contract refuses; `--verify-revoke` waits for you to Disconnect and shows reads failing.
  ```bash
  OIKO_CONNECTION='oiko1:…' pnpm example:agent
  OIKO_CONNECTION='oiko1:…' pnpm example:agent -- --verify-revoke
  ```
- **Telegram bot skeleton (no LLM):** `examples/agents/telegram-bot`. Maps chat commands (`/overview`, `/pay 5 usdt shop.testnet`, `/propose …`) to the MCP tools through an in-process MCP client. Requires `TELEGRAM_BOT_TOKEN`, `OIKO_CONNECTION` and `TELEGRAM_ALLOWED_CHAT_IDS` (it holds an agent key, so only listed chats may use it). Start with `pnpm --filter @oiko/example-telegram-bot start`.
- **Minimal REST client (TypeScript):**
  ```ts
  import { GatewayClient, decodeConnectionString } from "@oiko/sdk";
  const c = new GatewayClient(decodeConnectionString(process.env.OIKO_CONNECTION!));
  const me = await c.get("/api/agent/me");
  const r = await c.run("propose", { type: "save", to_pot: 2, token: "usdt", amount: "5000000" }, "Spend is above your usual level; this keeps your plan on track.");
  console.log(r.ok ? `proposal ${r.value}` : r.error);
  ```

## How to behave

- Read first. Say amounts with the ticker; never use a currency sign.
- Prefer `propose` for anything the owner should decide, with a short honest reason they will read.
- Never try to move money out of a locked pot.
- Earn rates are variable and can go to zero. Never promise a return.
- USDC and USDT are stablecoins, not bank deposits; they carry issuer risk.
