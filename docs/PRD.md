Oiko PRD
Product requirements for Oiko, a stablecoin savings home tied to your name on NEAR. It merges three ideas from the research page: Named Savings, Pay Me by Name and Dollar Ajo, plus an agent connector and a business mode. Written 30 Oct 2026 for the NEAR hackathon (deadline 14 Nov 2026, 23:59 UTC). Evidence and verification details are on the research page 'NEAR Hackathon idea research' (Rounds 2-3).
On this page
1. Overview
2. Problem and evidence
3. Goals and non-goals
4. Personas
5. User stories and acceptance criteria
6. Architecture
7. Key flows
8. UX principles
9. Security and threat model
10. Regulatory note
11. Metrics
12. Scope: 14 Nov vs later
Show all 19
1. Overview
One line
Your name is your money home: get paid to ada.near from any chain and watch it save itself into pots, locks, goals, yield and ajo circles. No gas, no seed phrase, no 24-hour withdrawal wait.
Oiko is a consumer app that holds only stablecoins (USDC and USDT), with no naira or fiat rails. You sign in with Google and get a named NEAR account. Anyone can pay that name from any chain through 1Click deposit addresses. Split rules then send each payment into pots: flexible, autosave, locked vault and goals. Optional yield comes from Rhea lending, protected by a utilization guard. On top sit optional ajo circles, a connector that lets outside AI agents act on your money within limits you set, built-in agent features, and a business mode for small shop owners. All custody and rules live in contracts the user owns; the Oiko team cannot move user funds.
Evidence status
The research rounds produced evidence for the savings, receive, ajo and private-AI parts. The agent connector and business mode (promo verdicts, leftover-cash agent, health record) come from a later brief I did not see in full. Their user stories below are product definitions, not evidence-backed claims. Validate them before you weight them in the pitch.
2. Problem and evidence
Savings apps hold your money hostage · primary
Google Play, Nigeria storefront, read 30 Oct 2026: 44 of the newest 400 PiggyVest reviews and 61 of the newest 400 Cowrywise reviews are 1-3 stars, mostly about withdrawal delays, flagged accounts and fees. Both apps have 1M+ installs and over 100k ratings each.
Wrong-network losses · primary + secondhand
'A client once sent me crypto to the wrong network. Gone.' (20 May 2026, x.com/i/status/2056999517434617873). One analysis found wrong-network sends in 34 of 420 wallet app reviews, and says recovery services charge $100-500 (dev.to, Q1 2026, secondhand).
Collectors run off with ajo money · primary
'the guy has disappeared with the whole savings circle' (29 Sep 2026, x.com/i/status/2104908039216079200). CircleFunds reports 10,000+ users (secondhand); Corral reports 300+ savers in 112 groups (Jul 2026).
Custodial and issuer risk · primary
'3 billion dollar drained from Binance hot wallet… Nothing is safe' (29 Oct 2026, x.com/i/status/2115933175603970243). 'Stablecoin issuers can freeze funds within hours' (29 Oct 2026, x.com/i/status/2115940748935791098).
People want private AI help with their money · primary
'I gave ChatGPT my bank statements…' (16 Oct 2026, x.com/i/status/2111078217784144167), set against 'Never upload… Bank statements' (13 Jun 2026, x.com/i/status/2065592487033323677).
who does 24hour withdrawals again in this 21st century
Cowrywise Play review, 1 star, 24 Oct 2026
there is no point calling it a stash if I can't access my money instantly
@OwoeyeMosope, 30 Oct 2026, x.com/i/status/2116104009358405877
3. Goals and non-goals
G1: Instant, self-custodied savings
Withdraw from the flexible pot in under 60 seconds, 24/7.
G2: Receive from any chain, without mistakes
5+ chains at launch, and a wrong-chain send to an address the user controls can be recovered.
G3: Saving happens automatically
Split rules run on every incoming payment.
G4: Honest yield
Show the variable rate live; no promised APY; a utilization guard.
G5: Agents act safely
Every outside agent gets a scoped key with limits and can be revoked in one tap.
G6: Runs from the README
The README runs and does exactly what it says; the demo is a real flow on mainnet.
1.
Non-goal: naira or fiat on-ramp and off-ramp. Users bring stablecoins; cash-out happens through their own exchange.
2.
Non-goal: non-stable assets, leverage or borrowing.
3.
Non-goal: custody by the Oiko team, or any admin key over user funds.
4.
Non-goal: KYC or licensing at the hackathon stage (see section 10).
5.
Non-goal: iOS app by 14 Nov. Web and Android first.
4. Personas
Ada, consumer saver (primary)
26, freelance designer in Lagos, paid in USDT by clients abroad. She keeps money on an exchange and spends it too easily. She wants locks, goals and her money available instantly. Today she uses PiggyVest and complains about withdrawals.
Tunde, agent-connecting power user
Developer who runs AI agents (trading, bill-paying, subscriptions). He wants to give an agent a capped budget without handing over his keys, and revoke it the moment it misbehaves.
Mama Ngozi, shop owner (business mode)
Runs a provisions shop and receives some stablecoin payments. She wants to know whether a supplier promotion is worth it, wants explanations in Pidgin, wants spare cash put to work automatically, and wants a record of her business's health she can show a lender.
5. User stories and acceptance criteria

| Module                                | User story                                                                                              | Acceptance criteria                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding                            | As Ada, I sign in with Google and get ada.oiko.near without seeing gas or a seed phrase.                | Signup takes under 45 seconds. The account is created by the relayer. A recovery method is set. The first transaction costs the user nothing. If the name is taken, alternatives are suggested.                                                                |
| Receive from any chain                | As a sender, I open ada's link, choose 'USDT on TRON', and pay without picking a network wrong.         | A deposit address matched to the chosen chain is shown with a QR code and expiry. Funds credit within 1Click's quoted time. Status is shown live. On failure, the refund goes to the sender's address.                                                         |
| Wrong-chain rescue                    | As Ada, money sent to my EVM address on the wrong chain still reaches me.                               | The rescue sweeper detects the balance on a chain-signature-derived address and sweeps it to Flex through 1Click after the user confirms. Fees are shown before the sweep.                                                                                     |
| Flexible pot                          | I withdraw anytime.                                                                                     | A withdrawal to any supported chain or address is submitted in under 60 seconds. There is no approval queue. Flex funds are never lent.                                                                                                                        |
| Autosave                              | 20% of every payment saves itself.                                                                      | Split rules (percentage or fixed amount per pot) run atomically on deposit. Edits take effect on the next deposit. A weekly fixed autosave from Flex runs on schedule.                                                                                         |
| Locked vault                          | I lock $200 until 1 Jan and can't break it.                                                             | The vault contract rejects withdrawal while now is before unlock_at, including by the Oiko team. After that date, only the owner can withdraw. The lock can be extended but never shortened.                                                                   |
| Goals                                 | I save toward 'Laptop $600'.                                                                            | Progress percentage and ETA are shown. Reaching the target sends a notification. Funds stay withdrawable unless the goal is also locked.                                                                                                                       |
| Yield (Rhea)                          | I switch on Earn for a pot and see the real, variable rate.                                             | The live Rhea supply APY and a risk note are shown before opt-in. New deposits pause when utilization is above 92%. Withdrawal shows queue risk if free liquidity is below the request. No APY is promised.                                                    |
| Ajo add-on                            | I start a 10-person $20 weekly circle and share it to WhatsApp.                                         | Members join with social login. Payout order is fixed in the contract. The organiser cannot withdraw the pot. Early collectors post a bond. Defaults are recorded on-chain.                                                                                    |
| Agent connector                       | As Tunde, I connect an agent with a $50 per week cap that can only pay allowlisted recipients.          | Oiko issues a function-call access key scoped to the policy contract. Per-transaction, daily and weekly caps, a recipient allowlist and an expiry are enforced on-chain. Revoking deletes the key in one tap. Every agent action appears in the activity feed. |
| Built-in agents                       | Oiko suggests 'move $40 idle Flex to Laptop goal' and runs it if I approve or have set it to auto.      | Suggestions come from NEAR AI cloud private inference (attestation shown). Agents act only through the same scoped policy as outside agents. Each suggestion has a one-tap undo where possible.                                                                |
| Business: promo verdict               | As Mama Ngozi, I paste or photograph a supplier promo and get 'worth it / not worth it' with the maths. | Shows the effective unit price, break-even sales and cash-flow impact using her own sales history. States its assumptions. Never moves money.                                                                                                                  |
| Business: Pidgin/English explanations | I read any verdict or alert in Pidgin or English.                                                       | Language can be toggled per message. Generated by NEAR AI. Numbers are identical across languages (checked by a test).                                                                                                                                         |
| Business: leftover-cash agent         | At close of day, spare cash above my float goes to Earn or a goal.                                      | The user sets the float threshold. The agent sweeps through a scoped key with a cap. It never touches the float. A daily summary is sent.                                                                                                                      |
| Business: on-chain health record      | I share a verifiable record of my takings and savings with a lender.                                    | Monthly aggregates (inflows, savings rate, ajo reliability) are committed on-chain as hashes, and the raw data stays private. A share link lets the lender verify against the chain. The record is opt-in.                                                     |

6. Architecture (on-chain and decentralised)
Contracts
oiko.near is the account factory (creates name.oiko.near). Each user has a vault contract with pots, locks, goals and split rules. Also: a Rhea adapter (inside the vault, which supplies directly to contract.main.burrow.near), an agent policy contract (caps, allowlist, expiry, per-key spend counters), an ajo circle factory plus circles, and a health registry (monthly hashes). Events follow NEP-297.
Data model
Pot {id, kind: flex|autosave|locked|goal, balance, token, unlock_at?, target?, earn: bool}. SplitRule {pot_id, pct|fixed}. AgentPolicy {key, per_tx, daily, weekly, allowlist[], expiry, spent}. Circle {members[], amount, period, order[], bonds, paid[round][member]}. HealthCommit {month, hash, schema_v}.
Access-key model
The user's full-access key comes from social login, with recovery. Oiko web and mobile get a function-call key limited to the vault and its methods. Each agent gets a function-call key limited to policy.execute, and its allowance is enforced in the contract. The Oiko team holds no keys on user accounts; the relayer only pays gas for NEP-366 delegate actions.
Indexer
Reads events from FastNEAR or NEAR Lake into Postgres to serve the activity feed, notifications and rescue detection. It is a cache only: the contracts are the source of truth, and the indexer can be rebuilt from the chain.
Frontend
Next.js web and an Expo Android app share a TypeScript SDK generated from the contract ABIs. Static web build, deployable to IPFS or Web4.
Off-chain services (replaceable)
Relayer, 1Click quote and status proxy, rescue sweeper, notifier, AI calls to NEAR AI cloud. None of them can move funds without the user's or a policy-scoped key.

| NEAR primitive                     | Used for                            | Verification status (30 Oct 2026)                                                              |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Named accounts and subaccounts     | name.oiko.near                      | Core protocol, standard                                                                        |
| Function-call access keys          | App and agent scoping               | Core protocol, standard                                                                        |
| Meta transactions (NEP-366)        | Gasless use                         | Not verified live; day-1 check of the relayer                                                  |
| Social login (FastAuth or similar) | Onboarding                          | Not verified; day-1 check                                                                      |
| 1Click / Intents                   | Pay in from any chain, withdraw out | Verified: /v0/tokens returned 210 tokens on 38 chains                                          |
| Chain signatures (v1.signer)       | Rescue addresses                    | Verified: public_key returned a secp256k1 key, block 222325806                                 |
| Rhea Lend                          | Earn                                | Verified: USDC 13.84% / USDT 13.85% APY; about 89% of supplied USDC lent out (block 222327202) |
| USDt / USDC on NEAR                | Base assets                         | Verified: usdt.tether-token.near ft_metadata; native USDC 17208628…                            |
| NEAR AI cloud-api (TEE)            | Private agents and explanations     | Verified: /v1/models and /v1/attestation/report returned HTTP 200                              |

7. Key flows
1.
Signup: Google, then the relayer creates ada.oiko.near, deploys the vault from the factory, adds an app function-call key, and seeds default pots and rules.
2.
Receive: the sender opens oiko.app/ada and picks a chain and token. A 1Click quote returns a deposit address. The sender pays. 1Click delivers USDC to ada's vault, which fires ft_on_transfer, which runs the split rules and emits events. A push notification follows.
3.
Withdraw: from Flex, a vault call requests a 1Click quote back out and transfers to the 1Click deposit address. Funds arrive on the user's chosen chain and address.
4.
Earn: the user toggles Earn on a pot. The vault supplies to Rhea through ft_transfer_call. The guard checks utilization (read off-chain and asserted against a value the contract reads; see open questions).
5.
Agent connect: the user picks a template, for example 'bill payer, $50/week, these recipients'. The policy is stored and a new function-call key added. A QR code or secret goes to the agent. The agent calls policy.execute. Revoke deletes the key.
6.
Ajo: create a circle, share the link, members join and contribute from Flex or from any chain, payouts run each round, and bonds are settled at the end.
7.
Business close of day: the leftover-cash agent reads the balance, sweeps anything above the float to Earn or a goal under its cap, then writes the summary and the health-record commit.
8. UX principles
1.
The chain is invisible: no gas, no seed phrase, no words like 'bridge', 'network' or 'RPC'. Senders pick 'where your money is', never a network ID.
2.
Naira reference view: an optional display-only figure shown beside the dollar balance ('≈ ₦…', sourced and timestamped). No naira is ever held or converted.
3.
Instant over clever: Flex withdrawal is always one tap.
4.
Honest numbers: variable APY is labelled 'today's rate', and risk appears before opt-in, not in fine print.
5.
Locks mean locks: say so plainly before confirming, with no hidden early-break option.
6.
Every agent action is visible, attributable to that agent, and revocable.
7.
English and Pidgin first-class; low-data mode; works on Android devices costing around $100.
9. Security and threat model

| Threat                                       | Mitigation                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oiko team or insider steals funds            | No admin keys on vaults. Factory-deployed code hashes are published. Upgrades only by the user's opt-in.                                           |
| Rogue or compromised agent                   | Function-call key limited to policy.execute. On-chain caps, allowlist and expiry. One-tap revoke. Anomaly alert when an agent hits 80% of its cap. |
| Prompt injection into built-in agents        | Agents only propose actions; execution goes through the policy contract's limits. Business promo verdicts never move money.                        |
| Relayer abuse or outage                      | Rate limits and a gas budget. If the relayer is down, the user can still act directly by paying a small gas fee (fallback).                        |
| Rhea insolvency, exploit or liquidity crunch | Earn is opt-in and capped per pot. Flex is never lent. Utilization guard. Clear risk copy.                                                         |
| Stablecoin issuer freeze                     | Disclosed. Users can choose a USDC/USDT split across pots to diversify.                                                                            |
| 1Click route failure                         | The quote's refund address is the sender. Status is polled and stuck payments surfaced. Tested with $1 amounts on mainnet.                         |
| Social-login account takeover                | Recovery and second-factor prompts for large withdrawals. A cooldown on adding new full-access keys.                                               |
| Health record privacy leak                   | Only hashes go on-chain; raw data stays on the device or encrypted. Sharing is opt-in.                                                             |

10. Regulatory note (honest)
Nigeria SEC's Proposed Rules on Digital and Virtual Asset Operations, Custody and Markets (published for comment 20 Aug 2026; sec.gov.ng/documents/1503) would bar a VASP from offering or 'facilitating' any yield arrangement, including lending and third-party protocols, without SEC authorisation. Foreign stablecoins would need SEC recognition to be used on regulated platforms. These rules are proposed, not final. Oiko's design reduces the risk but does not remove it: the app is non-custodial, Earn is an opt-in link to Rhea with no promised return, and Earn can be switched off by region. Ajo circles and business features may raise further questions. Get legal advice before any public launch. US and EU rules were not researched.
11. Metrics and KPIs

| Metric                                     | Hackathon target          | Post-launch target (90 days)    |
| ------------------------------------------ | ------------------------- | ------------------------------- |
| Signup to first deposit                    | Demo flow under 3 minutes | 40% of signups                  |
| Week-4 retention (any deposit or autosave) | n/a                       | 35%                             |
| Share of inflow auto-saved                 | n/a                       | 20% or more                     |
| Median Flex withdrawal time                | Under 60 seconds          | Under 60 seconds                |
| Wrong-chain rescues completed              | 1 live on mainnet         | Count and $ recovered           |
| Agents connected / revoked                 | 1 live with a revoke      | Agent actions within caps: 100% |
| Ajo circles completing a full cycle        | 1 with minute-long rounds | 80% complete without default    |

12. Scope: by 14 Nov vs later phases
Ships by 14 Nov 2026, 23:59 UTC · v1
Social login and named account; gasless relayer; receive by link from 5+ chains; withdrawal to any chain; Flex, autosave, locked vault and goals; split rules; Rhea Earn with guard; ajo add-on; agent connector (caps, allowlist, expiry, revoke); one built-in agent (idle-cash suggestion); business mode MVP (promo verdict and Pidgin/English explanations, leftover-cash sweep); rescue for EVM and TRON; web and Android.
Phase 2 (Dec-Jan) · later
Health record with lender share; iOS; more chains; portfolio presets; mutual recovery with a trusted circle; Telegram and WhatsApp bot.
Phase 3 · later
Licensing path, region gating, external audits, credit based on the health record and ajo reliability, merchant QR payments.
13. Parallel workstreams and 7 Nov critical path

| Workstream                 | Owns                                          | Interface it publishes on day 1                                   |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| Contracts                  | Factory, vault, policy, ajo, health registry  | ABI and NEP-297 event schema (frozen), generated TS types         |
| Intents / chain signatures | 1Click proxy, rescue sweeper                  | REST /deposit-address, /withdraw, status webhooks; recorded mock  |
| Onboarding / auth          | Social login, relayer, keys                   | SDK useSession() returning {accountId, signDelegate}              |
| Web                        | Next.js app                                   | Consumes the SDK only                                             |
| Mobile                     | Expo Android                                  | Consumes the SDK only                                             |
| Backend / indexer          | Events DB, notifier, read API                 | OpenAPI spec and a mock server                                    |
| AI                         | Built-in agent, promo verdict, Pidgin/English | POST /ai/suggest, /ai/verdict (returns structured JSON plus text) |
| Design                     | Flows, copy, risk copy                        | Figma and copy files by 3 Nov                                     |
| QA                         | Testnet e2e, mainnet $1 nightly run           | e2e suite in CI                                                   |
| Demo / content             | README, video, seed data                      | README draft by 7 Nov                                             |

Must be integrated and stable by 7 Nov
1) Google login creates ada.oiko.near with the vault deployed. 2) $1 of USDT on TRON paid through the link reaches the vault. 3) Split rules put it into Flex and a locked vault. 4) The lock refuses before its date and releases after it (1-minute lock for the demo). 5) Flex withdraws to a TRON or Base address. 6) An agent key with a $5 cap pays an allowlisted recipient, then is revoked. 7) docker compose up reproduces this on testnet. Layered on after 7 Nov: Rhea Earn and guard, goals UI, ajo, business mode, AI features, rescue, more chains, mobile polish.
1.
Day-1 lock: freeze the contract ABI and event schema, with one owner for changes.
2.
Day-1 lock: publish the OpenAPI spec and the 1Click mock so teams can build in parallel.
3.
Day-1 lock: fix the token list (native USDC, usdt.tether-token.near).
4.
Day-1 lock: shape of the Rhea integration (each vault supplies directly), plus checks on storage cost and whether withdrawal needs an oracle call.
5.
Day-1 lock: the access-key policy (exact method allowlists per key type).
6.
Day-1 lock: one docker-compose file, .env.example, shared testnet accounts, a capped mainnet QA wallet (about $50).
14. README promise and 2-minute demo
README promise
docker compose up starts Oiko at localhost:3000 on testnet, with a mock Rhea and a 1Click mock. npm run e2e runs signup, receive, split, lock, unlock, withdraw, agent connect and revoke, and an ajo round. A 'Mainnet proof' section lists real transaction hashes from $1 runs. Every claim in the README is covered by the e2e suite.
1.
0:00 Ada signs in with Google and claims ada.oiko.near; no seed phrase appears.
2.
0:15 A friend pays $5 from Bybit on TRON using the link. It lands and splits into Flex, a lock and the Laptop goal on screen.
3.
0:40 Ada withdraws $1 from Flex to Base in seconds. Caption: 'vs 24-hour approval'.
4.
0:55 She tries to break the lock and the contract refuses. Earn goes on, showing today's Rhea rate and the risk note.
5.
1:15 She connects an agent with a $2/week cap. It pays an allowlisted bill, then fails a third payment over its cap. She revokes it in one tap.
6.
1:35 Business mode: a photo of a supplier promo gets a verdict in Pidgin. The leftover-cash sweep runs.
7.
1:50 The ajo circle cameo, and the 1-minute lock releases to Ada.
15. Risks and open questions
Scope is very large for 14 days · high
The large team helps. Mitigation: everything on the 7 Nov critical path is fixed, and the rest sits behind feature flags. Judges check the README first.
Rhea yield and liquidity · high
About 89% of supplied USDC is lent out, leaving only about $1.4-1.6M free to withdraw, and the rate is variable.
Crowded market · medium
Jumpa, Busha, bachatpay and AnomaPay all offer stablecoin savings. Differentiation: name-based receiving from any chain, non-custodial locks, scoped agent keys.
Regulation · medium
Yield and stablecoin recognition under Nigeria SEC's proposed rules (section 10).
Open question: utilization guard
Can the vault read Rhea utilization on-chain cheaply, or does it rely on an off-chain guard?
Open question: 1Click delivery
Can 1Click deliver to a contract with an ft_transfer_call message, or is a relay step needed?
Open question: social-login provider
Which provider supports named accounts on mainnet today?
Open question: business mode demand
Business mode and the agent connector have no evidence from users yet; they need validation.
16. Track mapping

| Track               | Oiko feature                                                           | Fit                                            |
| ------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| realworld (primary) | Stablecoin savings, receive-by-name, wrong-chain rescue                | Strong                                         |
| social              | Ajo circles                                                            | Strong; can also be presented as its own entry |
| agents              | Agent connector with scoped keys, built-in agents, leftover-cash agent | Strong                                         |
| privacy             | Private AI via NEAR AI TEE, hash-only health record                    | Medium                                         |
| defi                | Rhea Earn, utilization guard                                           | Medium                                         |
| business            | Promo verdict, health record                                           | Medium (no evidence collected)                 |

17. Invest: stocks & RWA
Checked 30 Oct 2026. The live 1Click token list (1click.chaindefuser.com/v0/tokens, 210 tokens) has only one RWA: XAUT (Tether Gold) on Ethereum. It has no tokenized stocks, no PAXG and no treasury tokens. (SPX in the list is the SPX6900 meme coin, not the S&P 500.) Any stock exposure has to go through chain signatures on Solana or Ethereum.

| Asset                                                    | Chain / route from NEAR                                                                                                     | KYC and geography                                                                                                                                                        | Can a non-custodial contract hold it?                                   | Source (30 Oct 2026)                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| XAUT (gold)                                              | Ethereum. In 1Click, so you can swap straight from USDC/USDT intents                                                        | Holding it on-chain needs no KYC. Issuer redemption needs KYC (secondhand)                                                                                               | Yes, as an omft NEP-141                                                 | https://1click.chaindefuser.com/v0/tokens                                                                          |
| xStocks (TSLAx, SPYx…)                                   | Solana SPL-2022, ETH, Arbitrum, TON, Ink. Not in 1Click. Route: chain-signature Solana address → DEX (Raydium/Orca/Jupiter) | Not for US persons, US, UK, Canada or Australia. 110+ other countries are eligible. Issuer redemption needs KYC and has a $5,000 minimum. Tokens are freely transferable | Yes, they're permissionless tokens in a wallet that the MPC controls    | https://support.kraken.com/articles/xstocks-faq ; https://docs.xstocks.fi/docs/frequently-asked-questions          |
| Ondo Stocks / USDY                                       | ETH/Solana/others. Not in 1Click                                                                                            | Reg S only. Mint and redeem need Persona KYC. UK, Switzerland and Singapore are limited to qualified investors                                                           | You can hold them on the secondary market. Minting needs a KYC'd wallet | https://docs.ondo.finance/ondo-stocks/legal-and-regulatory ; https://docs.ondo.finance/ondo-stocks/important-notes |
| OUSG, BUIDL, BENJI, Superstate, Dinari, Robinhood tokens | Not checked this round                                                                                                      | Assumed accredited/whitelisted only (not checked)                                                                                                                        | Unlikely: transfers are whitelisted                                     | Gap                                                                                                                |

Invest tab design: - Three simple portfolios bought from a stablecoin pot: Gold (XAUT), US stocks (SPYx), and Mixed (50/50). Use XAUT first. - The user sets a target split. The agent rebalances only inside a scoped function-call key, with an allowlist of assets, a per-day cap, and slippage of 1% or less. - Everything settles on-chain into the user's own account or chain-signature address. - A geography check happens at onboarding: the user self-declares they are not a US person, and the xStocks rules are shown. Nigeria isn't on the xStocks exclusion list, but the SEC Nigeria proposed rules (sec.gov.ng/documents/1503, 20 Aug 2026) could treat the feature as an investment product.
Re-score: - Realworld impact +2, because "Dollar savings + gold + S&P" is a stronger pitch. - Risk −2, because of securities and regulatory exposure and the cross-chain route. - Net: Named Savings stays at about 58/70. - Hackathon scope: demo XAUT only via 1Click, which is fully verifiable today. Show SPYx as a "coming soon" tile, or as a stretch demo via chain signatures on Solana. Don't let the agent auto-buy stocks for the demo.
18. Design reference
Primary reference: Revolut. In customer-voted awards it was recognised for top-rated consumer and business app experiences, and named among digital-experience winners alongside Monzo (RFI Global UK Banking & Finance Awards, 19 Mar 2026: https://rfi.global/press-release-rfi-global-reveals-uk-banking-finance-awards-2026-winners/). It also has stocks, gold, crypto and savings Vaults in one app, which is the closest shape to Oiko. Secondaries: - Cash App for brand and simplicity. It won 2026 Webby Winner and People's Voice in Financial Services, and was nominated for Best UX (https://winners.webbyawards.com/2026/websites-and-mobile-sites/features-design/best-user-experience/372303/cash-app-brand-guidelines). - PiggyVest for local savings-goal patterns. This is based on the Play review sample from Round 3. No award evidence. No fintech won a 2026 Apple Design Award (https://developer.apple.com/design/awards/).

| Oiko screen   | Pattern to copy                                                                        | From                       |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------- |
| Onboarding    | One big input per screen, social login, balance shown before any crypto words          | Cash App                   |
| Home / pots   | Card stack of pots with emoji and progress ring; one total balance on top              | Revolut Vaults             |
| Savings goal  | Target, date, auto-save rule, and a streak or nudge                                    | PiggyVest                  |
| Invest        | Asset row with sparkline, a single 'Buy $' amount pad, risk sheet before the first buy | Revolut stocks/commodities |
| Send by name  | $cashtag-style handle search with avatar                                               | Cash App                   |
| Agent actions | Activity feed with a plain-English reason and an undo/revoke key button                | Oiko original              |

19. Landing page reference
Award evidence is thin. In the 2026 Webby Financial Services & Banking websites category, the winner was the Cash App Brand Guidelines site, not a product landing page. MetaMask, Cleo AI and Up were nominees. Reown won in 2025 (https://winners.webbyawards.com/winners/websites-and-mobile-sites/general-desktop-mobile-sites/financial-services-banking, checked 30 Oct 2026). Awwwards, CSSDA, Godly and Land-book were not checked. The picks below rest mainly on live page structure, fetched 30 Oct 2026.
Primary: Phantom (https://phantom.com). It's the closest match: a self-custody consumer money app. Its live sections are: hero 'Where the world trades', trading tools, 'Spend, Send, & Save', 'Controlled by you, secured by us', and a closing 'Get started / Download'. That's a short page that leads with the product and ends on trust. Secondaries: - Mercury (https://mercury.com) for trust and social proof. Its hero is 'Radically different banking', followed by numeric proof ('Loved by 450K+', '$1B annualized revenue'), plus 'Building banking for the agentic era' and a clear personal/business split. - Family (https://family.co) for the calm, plain-English crypto tone: 'Wallet activity you can understand', 'Relentless protection. Restful ease.', 'Effortless onboarding'. Revolut's site returned a bot-check page, so it was not reviewed.

| Section            | Oiko direction                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero               | 'Dollar savings with your name on it.' Subline: stablecoin pots, gold and US stocks, an agent that saves for you, and only you hold the keys. CTA: 'Get your name' (claim a .near-style handle) and 'Watch demo'. |
| Demo / animation   | A looping phone mock: create a pot, the balance ticks up at about 13.8% APY (Rhea), the agent moves $10 with a reason card. Keep it under 10 seconds and silent.                                                  |
| Social proof       | Before launch, no fake numbers. Use live on-chain stats (TVL supplied, pots created on testnet or mainnet) and 'Built at NEAR Hackathon'.                                                                         |
| How it works       | 3 steps: sign in with social → name your pot → fund in USDC/USDT from any chain (1Click).                                                                                                                         |
| Savings            | Pots with goals and progress rings; optional Ajo circle add-on.                                                                                                                                                   |
| Invest             | Gold (XAUT) live; US stocks tile marked 'coming soon, not for US persons'.                                                                                                                                        |
| Agent              | 'Your money coach, on a leash': scoped keys, daily caps, revoke in one tap. Show the activity feed.                                                                                                               |
| Business           | A one-line Mercury-style split, 'Oiko for teams', only if business mode ships. Otherwise omit it.                                                                                                                 |
| Trust and security | Phantom-style 'Controlled by you': non-custodial, keys via MPC/chain signatures, open-source contracts, the agent runs in an attested TEE (NEAR AI), and a risk disclosure link.                                  |
| CTA                | Repeat the hero CTA, plus a waitlist or testnet app link.                                                                                                                                                         |
| Footer note        | 'Built at NEAR Hackathon 2026', a GitHub link, and a disclaimer: not a bank; yields are variable; tokenized assets carry issuer and regulatory risk.                                                              |

Patterns to copy: - Short headline-led sections (Phantom). - Big numeric proof lines (Mercury). - Plain-English reassurance headings (Family). - A single CTA repeated top and bottom. Pitfalls to avoid: - Promising fixed APY. - Implying deposit insurance. - Showing stocks to US visitors without a geo note. - Heavy WebGL that hurts mobile load on Nigerian networks. - Crypto jargon above the fold. - Invented user counts.	
