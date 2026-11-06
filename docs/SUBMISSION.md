# Submission draft (for the human to post and submit; nothing has been posted or submitted)

Before submitting (deadline 2026-11-14 23:59 UTC): make the repo public, post on X with the video, then submit once with the payout account, repo link and post link. Keep the hosted demo up until at least 2026-11-18.

## X post (under 280 characters; attach the demo video)

Built at #NEARHackathon: Oiko. Personal finance meets personal intelligence. Get paid by name from anywhere, your plan splits every payment, and your own AI agent helps on limits your account enforces, with scam checks before it pays. @NEARProtocol https://oikodotnear.vercel.app

(279 characters. The rules ask for the video attached, a mention that it was built at NEAR HACKATHON, @NEARProtocol and #NEARHackathon.)

## 2-minute demo script

1. (0:00) Landing: "Personal finance meets personal intelligence." Type a name → Get your name.
2. (0:12) /start: claim the name, keep signed in on this browser. Accept the default plan (Bills 30%, Savings 20%, Rainy day 10% locked, a Goal 10%, Spend 30%).
3. (0:30) Open the pay link in a private window: "USDT on TRON", 100, refund address, deposit card + QR, "Simulate payment (test mode)"; the timeline reaches Done.
4. (0:48) Home: Total stables shows the payment split into pots. Try to withdraw from Rainy day: refused until its date.
5. (1:00) Agents: connect an agent with a 5 USDT weekly cap. Run it: two payments pass, the third is refused by the account, and the agent gets a how_to_fix ("use propose, or ask the owner to raise the weekly cap").
6. (1:22) The agent reads its events (the payment just received) and suggests a plan change. Home → "Waiting for you" → the suggestion with the agent's reason → Approve → the plan changes.
7. (1:40) Agents → Disconnect: the key is deleted; the agent's next read is refused.
8. (1:50) /security: keyless account, contract code hash, contracts on the explorer.

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
  "near_account": "<FILL: a mainnet NEAR account for the prize payout, e.g. team.near>",
  "contracts_testnet": ["oiko.testnet", "ajo.oiko.testnet", "usdc.oiko.testnet", "usdt.oiko.testnet", "lending.oiko.testnet"],
  "ai_tools_used": "Claude Code (coding); Grok (used as an outside agent to test the demo). The product has no built-in AI.",
  "notes": "NEAR Intents has no testnet; cross-chain payments are simulated on testnet with the real 1Click request/response shapes."
}
```
