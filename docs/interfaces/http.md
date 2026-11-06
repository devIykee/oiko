# Frozen HTTP API (v1)

Served by the Next.js app under `/api/*` (same code on Vercel, in docker compose and in dev). OpenAPI document at `/openapi.json`. All bodies are JSON and validated with zod. Errors: `{ "error": { "code": string, "message": string (plain English, what happened + what to do) } }`.

Amounts are decimal strings in base units (6 decimals) plus a `token` ticker field.

## Public

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/config` | | `{ network, root, contracts: {registry, usdc, usdt, lending, ajo, mpcSigner}, vaultCodeHash, explorer, features: {earn, ajo, mcp, rescue, invest, ajoDao} }` |
| GET | `/api/names/:name` | | `{ name, available, accountId, vaultId, exists, suggestions: [string] }` |
| POST | `/api/register` | `{ name, ownerPublicKey, appPublicKey }` | `{ accountId, vaultId, txHash }` — relayer calls `registry.register_name` |
| POST | `/api/relay` | `{ signedDelegate: base64 }` | `{ txHash, outcome }` — relayer wraps a NEP-366 SignedDelegate; only for receivers under the root and only allow-listed action shapes |
| POST | `/api/topup` | `{ accountId }` | `{ txHash? }` — tops up a user's/vault's NEAR gas buffer when below threshold (rate limited) |
| POST | `/api/sync` | `{ vaultId }` | `{ txHash }` — relayer calls permissionless `vault.sync()` |
| GET | `/api/stats` | | `{ names: number \| null, source: "registry" }` |
| GET | `/api/rates/earn` | | `{ source, fetchedAt, assets: [{ token, supplyApr: string, utilizationBps: number, paused: boolean }] }` |
| GET | `/api/rates/ngn` | | `{ source, fetchedAt, usdtNgn: string \| null, usdcNgn: string \| null }` |

## Intents (`/api/intents/*`)

Wraps 1Click (`ONECLICK_BASE_URL`, default real `https://1click.chaindefuser.com`; local/testnet use the built-in mock at `/api/mock-1click`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/intents/tokens` | | `{ groups: [{ id, label: "USDT on TRON", chain, symbol, assetId, decimals }] }` |
| POST | `/api/intents/deposit-address` | `{ name, originAsset, amount, refundTo, invoiceId? }` | `{ depositAddress, depositMemo?, amountIn, amountOut, fee, deadline, quoteId, destinationToken }` — with `invoiceId` the server ignores `amount`, quotes what is left to pay on the invoice (origin must be the invoice's stablecoin), records the deposit (and its test-mode ticket) on the invoice, and adds `invoiceId` to the response |
| POST | `/api/intents/withdraw-quote` | `{ vaultId, potId, token, amount, destinationAsset, destinationAddress }` | `{ depositAddress, amountIn, amountOut, fee, deadline, timeEstimate }` |
| GET | `/api/intents/status/:depositAddress` | | `{ status: "PENDING_DEPOSIT" \| "KNOWN_DEPOSIT_TX" \| "PROCESSING" \| "SUCCESS" \| "INCOMPLETE_DEPOSIT" \| "REFUNDED" \| "FAILED", updatedAt }` — on SUCCESS the server calls `sync()` on the vault |
| POST | `/api/intents/simulate-deposit` | `{ depositAddress, memo?, ticket?, invoiceId? }` | testnet/local only: the mock marks the deposit as sent; with `invoiceId` the newer ticket is stored on the invoice |

## Agent gateway (`/api/agent/*`)

Auth: header `Authorization: NEP413 <base64(json)>` where json = `{ accountId (vault id), publicKey, signature, nonce (base64 32 bytes), message }`; `message` = `"<METHOD> <path>\n<sha256 hex of body>\n<unix ms timestamp>"`, recipient = `"oiko-gateway"`. The gateway checks the signature (NEP-413), timestamp within 5 minutes, nonce not seen, the key still exists on the vault (`view_access_key`), and the vault policy (not revoked, not expired, scope). Every call is written to the access log.

| Method | Path | Scope | Response |
|---|---|---|---|
| GET | `/api/agent/me` | read | policy, remaining caps |
| GET | `/api/agent/overview` | read | balances, pots, goals, splits, bills (amounts as strings + tickers, with `_help` descriptions) |
| GET | `/api/agent/pots` | read | |
| GET | `/api/agent/activity?limit=` | read | |
| GET | `/api/agent/goals` | read | |
| GET | `/api/agent/splits` | read | |
| GET | `/api/agent/bills` | read | |
| GET | `/api/agent/insights?month=yyyymm` | read | |
| GET | `/api/agent/earn-rates` | read | |
| GET | `/api/agent/ajo` | read | |
| GET | `/api/agent/invoices` | read | the owner's invoices: `{ invoices: [{ id, number, client, status, issue_date, due_date, items, total, paid, received, fee, remaining, paid_at, note, transactions }] }` (read only; no agent write access to invoices) |
| POST | `/api/agent/prepare` | propose/act | `{ kind: "propose" \| "act", action, reason? }` → `{ unsignedTx: base64, hash: base64 }` (signer = vault, key = agent key, method `agent_propose` / `agent_execute`) |
| POST | `/api/agent/submit` | propose/act | `{ signedTx: base64 }` → `{ txHash, ok, error? }` |
| GET | `/api/agent/counterparty?to=&amount=&token=` or `?bill_id=` | read | counterparty check for a payment: `{ receiver, verdict: "allow"\|"warn"\|"block", score, reasons: [{code, severity, message, evidence?}], checkedAt, sources, on_allowlist, decision: {act, propose, message} }` |
| POST | `/api/agent/report` | read | `{ receiver, reason, evidence }` → `{ ok, receiver, stored, note }` — shared blocklist, one report per account per receiver |
| GET | `/api/agent/events?since=` | read | `{ events: [{ id, type, at, title, data, suggested_actions }], cursor }`, oldest first (docs/AGENTS.md#events-proactive-agents) |
| GET | `/api/agent/brief?month=yyyymm` | read | deterministic month summary with `facts[]` |
| GET | `/api/agent/changes` | read | this agent's change proposals |
| GET | `/api/agent/autopilot` | read | `{ autopilot, webhook }` |
| POST | `/api/agent/change` | propose (NEP-413 or session bearer) | `{ change, reason }` → stored proposal `{ id, status, summary, calls, expiresAt, … }` |
| POST | `/api/agent/webhook` | read (NEP-413 or session bearer) | `{ url }` → `{ url, secret, note }`; `{ url: null }` → `{ ok, removed }` |
| GET | `/api/agent/log?vaultId=&publicKey=` | owner (NEP-413 by owner app key) | access log rows |
| GET | `/api/owner/changes` | owner | `{ changes: [ …proposal, calls, problem ] }` (every agent, newest first) |
| POST | `/api/owner/changes/:id` | owner | `{ decision: "approve" \| "reject", txHashes }` → the proposal. The app runs `calls` with its key before recording an approval; `draft_invoice` is saved as a draft here |
| GET/POST | `/api/owner/autopilot` | owner | `{ autopilot }`; POST body `{ top_up_bills, sweep_spend, pay_bills_on_due_day, spend_floor }` |

Agent errors carry `error.how_to_fix` (and `submit` failures `error.how_to_fix`).

`/api/agent/prepare` runs the counterparty check for `pay` and `pay_bill` (docs/COUNTERPARTY.md): `block` → 403 `E_COUNTERPARTY_BLOCKED` (act and propose), `warn` on `act` → 409 `E_COUNTERPARTY_WARN` with `error.next = "propose"`. Both errors carry `error.counterparty` (the full result). A successful prepare for a payment includes `counterparty` in the response.

Public: `GET /api/counterparty/:accountId?vault=&amount=&token=` (no auth, 30/min per IP) returns the same result shape without `decision`; `vault` adds the prior-payment signal.

## Invoices (`/api/invoices/*`)

Owner auth = the same NEP-413 header as `/api/agent/log`, signed by a key on the owner's **name account** (`accountId` = `ada.oiko.near`, normally the app key). Amounts are base-unit strings (6 decimals) plus `token`. Dates are `yyyy-mm-dd` (UTC). Line total = quantity (up to 4 decimals) × unit price, rounded half up to a base unit; totals are summed with bigint.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/invoices` | owner | | `{ storage, invoices: [OwnerInvoice] }`, newest first; unfinished deposits are refreshed from 1Click |
| POST | `/api/invoices` | owner | `{ fromName, client: {name, email?}, items: [{description, quantity, unitPrice}], token: "usdc"\|"usdt", dueDate, note?, state?: "draft"\|"open" }` | `OwnerInvoice` (201). `id` = 16 random bytes, base58; the public page is `/i/<id>`; `number` = `INV-0001`… per owner |
| GET | `/api/invoices/:id` | none (or owner) | | `PublicInvoice` (no client email, no tickets; drafts are 404). With the owner header: `OwnerInvoice` |
| PATCH | `/api/invoices/:id` | owner | any of the POST fields, `state: "open"\|"cancelled"` | `OwnerInvoice`. Content can change only until money starts moving (`E_NOT_EDITABLE` 409); paid or in-flight invoices can't be cancelled |
| GET | `/api/invoices/export.csv` | owner | | `text/csv; charset=utf-8` (BOM, CRLF), one row per line item: Invoice number, Issue date, Due date, Client, Description, Quantity, Unit price, Line total, Currency (USDC/USDT), Invoice total, Status, Paid date, Amount received, Fee, Transaction link. ISO dates, plain decimals, RFC 4180 quoting; text cells starting with `= + - @` get a leading `'` |

`PublicInvoice` = `{ id, number, owner, ownerName, fromName, client: {name}, token, items: [{description, quantity, unitPrice, lineTotal}], total, paid, received, fee, remaining, issueDate, dueDate, note, status, payable, inFlight, paidAt, transactions: [{hash, url}] }`. `OwnerInvoice` adds `client.email, state, editable, createdAt, updatedAt, payments: [{originLabel, status, amountIn, originDecimals, amountOut, fee, createdAt, updatedAt, completedAt, transactions}]`.

Status (derived on every read from the 1Click status of the invoice's deposits; the deposit ticket is stored with the invoice so any instance can refresh it):
- `draft` (stored), `cancelled` (stored, unless already paid)
- `paid`: successful deposits add up to the total (counted as what the payer sent; `received` is what arrived after the fee; on SUCCESS the account's `sync()` runs, and its NEAR tx hashes are the transaction links)
- `pending`: a deposit is received / processing / incomplete, or part of the total is paid (`received` shows how much)
- `refunded`: the last started deposit was refunded and nothing is paid (the client can pay again)
- `overdue`: open and past `dueDate`; otherwise `open`

## Agent discovery

- `/.well-known/oiko-agent.json` — tools, auth, limits, endpoints.
- `/llms.txt` — plain-text guide for agents.
- MCP over streamable HTTP: `POST /api/mcp` (stateless). MCP over stdio: `npx oiko-mcp` (package `packages/mcp`).
