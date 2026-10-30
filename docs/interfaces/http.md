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
| POST | `/api/intents/deposit-address` | `{ name, originAsset, amount, refundTo }` | `{ depositAddress, depositMemo?, amountIn, amountOut, fee, deadline, quoteId, destinationToken }` |
| POST | `/api/intents/withdraw-quote` | `{ vaultId, potId, token, amount, destinationAsset, destinationAddress }` | `{ depositAddress, amountIn, amountOut, fee, deadline, timeEstimate }` |
| GET | `/api/intents/status/:depositAddress` | | `{ status: "PENDING_DEPOSIT" \| "KNOWN_DEPOSIT_TX" \| "PROCESSING" \| "SUCCESS" \| "INCOMPLETE_DEPOSIT" \| "REFUNDED" \| "FAILED", updatedAt }` — on SUCCESS the server calls `sync()` on the vault |
| POST | `/api/intents/simulate-deposit` | `{ depositAddress }` | testnet/local only: the mock marks the deposit as sent |

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
| POST | `/api/agent/prepare` | propose/act | `{ kind: "propose" \| "act", action, reason? }` → `{ unsignedTx: base64, hash: base64 }` (signer = vault, key = agent key, method `agent_propose` / `agent_execute`) |
| POST | `/api/agent/submit` | propose/act | `{ signedTx: base64 }` → `{ txHash, ok, error? }` |
| GET | `/api/agent/log?vaultId=&publicKey=` | owner (NEP-413 by owner app key) | access log rows |

## Agent discovery

- `/.well-known/oiko-agent.json` — tools, auth, limits, endpoints.
- `/llms.txt` — plain-text guide for agents.
- MCP over streamable HTTP: `POST /api/mcp` (stateless). MCP over stdio: `npx @oiko/mcp` (package `packages/mcp`).
