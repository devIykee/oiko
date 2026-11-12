# Optional privacy with Gloam: design note

Status: **option A built behind `FEATURE_PRIVATE_PAY` (off by default).** This note was written and agreed before any code, as the build rules ask for anything near money flows. Facts checked on 2026-11-12 against the live gloam.trade docs (`/docs`, `/docs/sdk`, `/docs/sdk/reference`, `/docs/privacy-model`, `/docs/bridge`, `/docs/chain`) and the published package `@gloamtrade/sdk@0.7.0` (unpacked source, `src/builders.ts`, `src/constants.ts`). Anything not checked is marked **UNVERIFIED**.

## 1. What Gloam is (verified)

- A shielded-pool contract (`ShieldPoolPayments`) with Groth16/Poseidon verifiers, deployed on EVM chains: Robinhood Chain, Tempo, Base, Ethereum, Elysium (mainnets), plus Base Sepolia, Ethereum Sepolia and two other testnets. "Gloam is not a chain."
- The "plugin" is the TypeScript SDK `@gloamtrade/sdk` (npm description: "The private path other apps and agents plug into"). Dependencies: `viem`, `circomlibjs`; peer `snarkjs`. Browser and Node.
- The SDK never holds a key: builders return an unsigned intent; the caller signs. A note's `secret` is "the sole spend authority".
- Cash out: `buildUnshieldIntent({ secretHex, amountWei, asset?, to: Address, path, prove, ... })`. `to` is an **EVM address**. The vault keeps a cash-out fee (0.5% per the docs) and `to` receives the rest.
- **No NEAR support.** Neither the docs nor the SDK source mentions NEAR, NEP-141 or NEAR Intents.
- Gloam's own statement of what is public: each shield deposit (address, asset, amount), each cash out (asset, amount, destination), the caller of each transaction, timing. Private: who paid whom and how much on a private send inside the pool, holdings inside the pool, and the link between a deposit and a later spend or exit.
- Trust: client-side proofs; no admin withdraw; a single owner wallet can change limits and fees (multisig planned) with a 3-day timelock on verifier/rate changes; a team-run relayer submits proven transactions; OFAC screening through Gloam's server, which sees public addresses; vault contracts audited (Kann Audits, 2026-11-01), circuits, relay and app not covered.

## 2. What Gloam can and cannot make private in Oiko

Oiko's money lives in `vault.<name>.<root>`, a keyless NEAR contract that enforces locks, the plan and agent limits (`docs/SECURITY.md` sections 1 to 4). Gloam pools live on EVM chains.

| Asked for | Possible with Gloam? | Why |
|---|---|---|
| Private balances | **No** | Vault balances are NEAR state, readable by anyone. Gloam cannot shield NEAR state. Moving money into a Gloam pool means taking it out of the vault, where locks, the large-withdrawal threshold and agent caps no longer apply. That would break the security model, so it is ruled out. |
| Private amounts | **No** for what the recipient sees. The 1Click delivery into the vault and every vault event are public on NEAR. The Gloam cash out itself also shows its amount. |
| Private payer | **Yes, partly.** A sender with a Gloam balance on Base or Ethereum cashes out USDC/USDT straight to the 1Click deposit address shown on `/pay/<name>`. On-chain, that payment is not linked to the wallet that originally funded the Gloam pool. |
| Private cross-chain deposits | **No** beyond the above. Gloam says a deposit (or bridge) into the pool is public. |
| Agents | **Not affected.** Nothing changes in `agent_execute`, caps, allowlist or expiry. |

So the only honest feature is **"Pay privately from a Gloam balance"**: a payer-side option on the pay page. It hides who paid from the public record. It does not hide that the Oiko account received money, or how much.

## 3. Proposed feature (if approved)

- Flag: server env `FEATURE_PRIVATE_PAY` (like the other `FEATURE_*` flags), **off by default**, sent to the browser as `features.privatePay` in `/api/config`. Off: `/pay` is exactly as before, and `GET /api/private-pay` answers 404 `E_DISABLED`.
- On, a second opt-in: the refund step shows a switch "I'm paying from a Gloam private balance", **off** until the sender turns it on, and only for origins Gloam can pay from. Oiko's list has three: USDC on Base, USDC on Ethereum, USDT on Ethereum (matched by exact 1Click asset id, whose token contracts are the same ones Gloam's pools hold: `0x8335…2913`, `0xA0b8…eB48`, `0xdAC1…1ec7`). Gloam also holds USDT on Base, but 1Click does not list it as an origin.
- Switch on:
  1. under the refund field, a warning that a refund goes to that address, so a refund to their usual address links it back to them;
  2. on the deposit step, a "Paying from Gloam" card with the amount to cash out, grossed up for Gloam's fee so the deposit address receives exactly the quoted amount. The fee is read live from the pool (`withdrawFeeBps()`, cached 5 minutes); if it can't be read the amount shows "n/a" and the card says to check the fee in Gloam;
  3. what is hidden (which account the money came from) and what stays public (that the payee received the amount, and the cash-out amount), and that Oiko never asks for a Gloam secret.
- Code: `apps/web/lib/privatePay.ts` (origins, fee and gross-up math), `apps/web/server/privatePay.ts` (live fee read), `apps/web/app/api/private-pay/route.ts` (`GET ?asset=<1Click asset id>&amount=<base units>`, same per-IP limit as `intents`), `apps/web/components/app/PayFlow.tsx`. Optional env `GLOAM_RPC_BASE`, `GLOAM_RPC_ETHEREUM` (defaults: `https://mainnet.base.org`, `https://ethereum-rpc.publicnode.com`).
- Oiko never asks for, sees or stores a Gloam note secret. The sender cashes out in their own Gloam app (option A below).
- Reuse of the existing seam: the 1Click quote keeps today's `depositType: ORIGIN_CHAIN` and `confidentiality` stays at today's value. Gloam works before the deposit address, so it does not need, and should not be confused with, NEAR's `CONFIDENTIAL_INTENTS`. That seam stays the place for NEAR-side confidentiality, which is a separate decision.

### Option A (recommended): guided cash out, no SDK in Oiko
The pay page gives the sender the destination and exact amount, and the sender does the cash out in Gloam. Adds no dependency, no keys and no bundle weight (the pay page is the most important screen and has a performance budget).

### Option B: embedded SDK cash out
The pay page loads `@gloamtrade/sdk` + `viem` + `snarkjs`, takes the sender's note secret, builds the proof in the browser and asks their EVM wallet to sign. Not recommended: Oiko's pay page would handle another product's spend secret (a front-end compromise could then steal the sender's Gloam funds, a threat Oiko does not have today), it adds a wallet connection to a flow that has none, and the proving artifacts are heavy on a slow phone.

## 4. Security model: unchanged

No contract changes. The vault stays keyless, locks still refuse every outflow, agent caps, allowlist and expiry are still enforced only by the contract. The feature touches only the sender's side before the money reaches 1Click. It cannot raise a limit because it never reaches the vault except as an ordinary incoming payment, which goes through the plan like any other.

New risks to document in `SECURITY.md` if built: users overestimating the privacy (copy must say exactly what is hidden); a refund re-linking the payer; Gloam's own trust assumptions (single owner wallet, team relayer, OFAC server seeing addresses, circuits not audited).

## 5. Verified while building (2026-11-12)

- `eth_call` of `withdrawFeeBps()` (selector `0x7aca2b59`) on `0x39E28Cde55CAB798874746ac52cb4B5Cc99a0194` answers `0x…32` = **50 bps** on both Base (`mainnet.base.org`) and Ethereum (`ethereum-rpc.publicnode.com`).
- The pool's fee rounding is `floor(amount × bps / 10000)` (SDK `cashOutFee`). Oiko's gross-up returns the smallest cash out that still delivers the full amount; a unit test checks that property for several fees and amounts (100 USDC at 0.5% → cash out 100.502512).

## 6. UNVERIFIED

- That a 1Click deposit address credits a deposit that arrives as an ERC-20 transfer from the Gloam pool contract (not from an externally owned account). Expected, since 1Click watches the address balance, but not tested. NEAR Intents has no testnet, so this cannot be tested end to end without real money.
- What 1Click does when slightly less than the quoted amount arrives (fee rounding): refund, partial fill or delay.
- Gloam's cash-out fee being 0.5% on every chain at the time of payment (read live if built).
- Gloam's limits (50,000 per deposit, 2,500,000 per stablecoin) and the relayer's behaviour, taken from its docs only.
