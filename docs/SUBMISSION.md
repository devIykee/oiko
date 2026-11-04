# Submission draft (for the human to post and submit; nothing has been posted or submitted)

## X post (under 280 characters)

Built at NEAR HACKATHON: Oiko, personal finance with your name on it. Get paid to ada.oiko from anywhere, your plan splits every payment, locks no one can break, and your own AI agent helps on budgets the account enforces. Try it: https://oikodotnear.vercel.app

## 2-minute demo script

1. (0:00) Landing: "Personal finance meets personal intelligence." Type a name → Get your name.
2. (0:15) /start: claim the name, keep signed in on this browser. Accept the default plan (Bills 30%, Savings 20%, Rainy day locked, a Goal).
3. (0:35) Open the pay link in a private window: "USDT on TRON", 100, refund address, deposit card + QR, Simulate payment (test mode); timeline reaches Done.
4. (0:55) Home: balance shows 100 USDT split into pots. Try to withdraw from Rainy day: refused until its date.
5. (1:10) Withdraw 1 USDT from Spend.
6. (1:20) Agents: connect a Bill payer with a 5 USDT cap; run the scripted agent: two payments pass, the third is refused by the account. Disconnect: key deleted.
7. (1:45) /security: keyless account, code hash, contracts on the explorer.

## Tracks

| Code | Track | Fit |
|---|---|---|
| 08 `RWM` (primary) | Real-World Money | personal finance a person could use tomorrow: pay by name from any chain, a plan for every payment, bills, savings, locks, no seed phrase |
| 06 `SEC` | AI Security & Defense | keyless money account, immutable locks, scoped agent keys with on-chain caps, allowlist and expiry, NEP-413 gateway, one-tap revoke |
| 07 `AGT` | Agent Economy | any outside agent manages money over MCP (stdio + HTTP) or REST, within budgets the contract enforces |
| 01 `DFI` | Unstoppable DeFi | Earn on Rhea lending with an on-chain utilization guard (refuses above 92%) |

## Submission JSON template

```json
{
  "project_name": "Oiko",
  "tagline": "Personal finance meets personal intelligence.",
  "tracks": ["RWM", "SEC", "AGT", "DFI"],
  "primary_track": "RWM",
  "repo_url": "https://github.com/devIykee/oiko",
  "demo_url": "https://oikodotnear.vercel.app",
  "video_url": "<FILL: demo video URL>",
  "team": [{ "name": "<FILL>", "email": "<FILL>", "x_handle": "<FILL>" }],
  "near_account": "<FILL>",
  "contracts_testnet": ["oiko.testnet", "ajo.oiko.testnet", "usdc.oiko.testnet", "usdt.oiko.testnet", "lending.oiko.testnet"],
  "ai_tools_used": "Claude Code",
  "notes": "NEAR Intents has no testnet; cross-chain payments are simulated on testnet with the real 1Click request/response shapes."
}
```
