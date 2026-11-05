# oiko-mcp

MCP server that lets your own AI agent (Claude Desktop, Cursor, or any MCP client) read and act on an [Oiko](https://oikodotnear.vercel.app) account, inside limits the account itself enforces.

Oiko has no built-in AI. Your agent brings the intelligence; Oiko brings the rules: per-payment, daily and weekly caps, an allowlist of who the agent may pay, an expiry, and a counterparty check before every payment. The agent's key is a function-call key that can only call two methods on your account, and you can delete it with one tap.

## Connect

1. In Oiko, open **Agents → Connect an agent**. Choose what it may do and its limits. Oiko generates the agent's key in your browser and shows a one-time connection string (`oiko1:…`).
2. Add the server to your MCP client:

```json
{
  "mcpServers": {
    "oiko": {
      "command": "npx",
      "args": ["-y", "oiko-mcp"],
      "env": { "OIKO_CONNECTION": "oiko1:..." }
    }
  }
}
```

Instead of `OIKO_CONNECTION` you can set `OIKO_AGENT_KEY` (ed25519 secret key), `OIKO_VAULT_ID` and `OIKO_API_URL` (default `https://oikodotnear.vercel.app`).

The key stays on your machine: every request to Oiko is signed locally (NEP-413) and every transaction is signed locally.

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `get_overview`, `get_pots`, `get_goals`, `get_splits`, `get_bills`, `get_invoices`, `get_activity`, `get_insights`, `get_earn_rates`, `get_rosca_groups` | read | Balances, pots, plan, bills, invoices, activity, monthly numbers, rates, ROSCA groups. Amounts are strings with tickers. |
| `check_counterparty` | read | Ask whether a payee looks safe: allow, warn or block, with reasons. |
| `report_counterparty` | read | Report a scam payee with evidence. |
| `propose` | propose | Suggest an action with a reason; nothing happens until the owner approves. |
| `act` | act | Pay, pay a bill, move or save, within the caps and allowlist. Refuses on a blocked payee; on a warning, propose instead. |

## Limits worth knowing

- The account (a NEAR contract) checks every cap, the allowlist and the expiry itself. An agent that skips this package is still limited.
- Revoking the agent in Oiko deletes its key on-chain; reads and actions stop at once.
- Locked pots can't be touched by anyone, the agent included.

Docs: [docs/AGENTS.md](https://github.com/devIykee/oiko/blob/main/docs/AGENTS.md). Licence: MIT.
