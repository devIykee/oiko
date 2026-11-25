# Oiko privacy: Veil

Personal finance data says a lot about a person. A pot called "Divorce lawyer", a bill called "Therapy" or an invoice to "Discreet Clinic" should not be readable by anyone who looks up an account on a NEAR explorer, and not by Oiko's own server either. This document describes **Veil**, the privacy layer that keeps those labels private, and is honest about what it does not hide.

Code: `packages/sdk/src/veil.ts` (format, keys, seal/open), `packages/sdk/src/vault.ts` (sealing on write, opening on read), `apps/web/lib/{viewKey,privacy,sealedInvoice}.ts` (app), `packages/mcp/src/gatewayBackend.ts` (agents). Tests: `packages/sdk/test/veil.test.ts`, `apps/web/server/__tests__/privateInvoices.test.ts`, `packages/mcp/test/mcp.test.ts`, `contracts/vault/src/tests.rs` (`veil_tokens_fit_and_round_trip_through_json_args`).

## The problem

Everything a NEAR contract stores and every argument it receives is public. Oiko's savings account (the vault) has to see amounts, pots, locks, plans and payees to enforce them: that is what makes the rules hold without trusting Oiko. But the vault never needs to know what a pot or a bill is *called*. Before Veil, these were stored in plain text:

| Where | What leaked |
|---|---|
| Vault state and `get_overview` | pot names and icons, bill names, agent proposal reasons |
| Activity log and NEP-297 events | the same names, copied into `pot_created`, `bill_added`, … |
| Oiko's server (Postgres) | invoice client names, emails, line descriptions, notes; agent change-proposal reasons |

## Constraints

1. **The vault cannot be changed.** It has no upgrade method and no admin by design (`docs/SECURITY.md` section 1), and accounts use its code by hash. A privacy feature that needs new contract code would only reach new accounts, after a redeploy.
2. **The vault limits names to 40 characters**, counted as Unicode scalar values (`check_text` in `contracts/vault/src/core.rs`, and `add_bill_t`). An authenticated ciphertext in base64 is at least 12 + 16 bytes of overhead = 38 characters before any text.
3. **The server must not hold the key.** Otherwise "private" would only mean "private from everyone except the operator".
4. **Agents must keep working**, and an owner must be able to let an agent read their labels without giving it anything else.

## Design

### 1. Sealed labels that fit the deployed contract

A sealed label (a *token*) is

```
"🔒" + base32768( nonce[12] ‖ ChaCha20-Poly1305(key, nonce, aad, pad(text)) ‖ tag[16] )
pad(text) = [u16 length][utf-8 text][zeros] to a fixed bucket: 40, 168 or 488 bytes
aad       = "oiko-veil/v1:" + vault account id
```

**Base32768.** Instead of base64 (6 bits per character), Veil writes **15 bits per character** using 32,768 code points from three contiguous, assigned blocks that survive Unicode normalisation: CJK Extension A (U+3400–U+4DBF), CJK Unified Ideographs (U+4E00–U+9FFF) and the first 5,184 Hangul syllables (U+AC00–U+C03F). The idea comes from qntm's base32768, which packs binary data into Twitter's character limit; here it packs a ciphertext into a smart contract's character limit. A padded name is 12 + 40 + 16 = 68 bytes = 37 characters, plus the marker: **38 characters, under the vault's limit of 40**. So Veil works on every vault already deployed, with no new code hash and no migration. The contract test feeds real tokens through the vault's own JSON parser (raw UTF-8 and `\u` surrogate escapes) and its length checks.

Each token is also a valid string everywhere else: JSON, Postgres, URLs once encoded, and Rust's `String`.

**Padding hides length.** Every sealed pot or bill name is exactly 38 characters, whether it says "Gym" or "Savings for the twins' school". Longer fields (proposal reasons, up to 280 characters on the contract) use the 168- or 488-byte buckets, so only the bucket shows.

**Binding.** The vault id is the associated data, so a token copied into another account fails to open. Any changed character fails the Poly1305 tag check. A random 96-bit nonce per seal means sealing "Rent" twice gives two unrelated tokens, so nobody can tell that two accounts both have a pot called "Rent". With at most a few hundred labels per account, the chance of a nonce collision is negligible.

**Self-delimiting.** Tokens start with 🔒 and have one of three fixed lengths over a private alphabet, so they can be found inside any longer text. The server builds sentences like "Rent is due tomorrow" from vault data it cannot read. The server writes "🔒䵁噒…瑀 is due tomorrow", and the owner's app or the agent opens the token inside the sentence (`Veil.openText`). The same goes for any JSON (`Veil.openDeep`), which is how the app opens a whole `get_overview` in one call.

### 2. The view key

```
view key = HKDF-SHA256(ikm = owner key seed, salt = "oiko/veil/v1", info = "view:" + identity account)
```

The owner key is already derived on demand from the passkey's PRF output, or kept in the browser for "this browser" sign-in (`apps/web/lib/passkey.ts`). So **every device that can sign in as the owner derives the same view key**, with no extra secret to back up and nothing new on the server. The view key is separate from the signing key: sharing it lets someone *read* labels but not move money, sign anything or change the account. That separation mirrors Zcash's viewing keys and Secret Network's viewing keys.

Where it lives:

- **Sign-up and passkey sign-in** derive it immediately and keep it in the browser session (`Session.viewKey`). It is never sent to Oiko.
- **"This browser" sessions** made before Veil derive it the next time the app loads.
- **Passkey sessions made before Veil** show "Unlock private labels" in Settings, which asks for the passkey once.
- **"Move to another device"** codes carry it inside the passphrase-encrypted payload.
- On a device that has not unlocked it, sealed labels read as "Private". The raw ciphertext is never shown.

### 3. Seal on write, open on read

`VaultClient` takes an optional `privacy` argument (`packages/sdk/src/vault.ts`):

- a `Veil`: `createPot`, `updatePot` (name and icon), `addBill` and `agentPropose` (reason) seal before signing. Every view (`overview`, `pot`, `bills`, `activity`, `proposals`, `agents`) is opened after reading.
- `"mask"`: reads replace tokens with "Private" (devices without the key).
- nothing: raw contract values, as before.

The web app passes the Veil when **Settings → Privacy → Private labels** is on (the default). "Make existing pot names private" re-saves the pots that still have plain names. Bills have no update method on the vault, so an existing bill's name stays as it is until the bill is added again. Plain names (older pots, "Spend") keep working: `open` passes non-tokens through unchanged, and `seal` never double-seals.

### 4. Agents

An agent gets the view key only if the owner turns on **"Let it read private names"** when connecting it. The key is then added to the `oiko1:` connection string as `vk`, or can be set as `OIKO_VIEW_KEY=oikoview1:…` for `oiko-mcp`. The stdio MCP server (`GatewayBackend`) opens every read in the agent's own process and seals the reasons it writes (`propose`, `propose_change`) before they leave it, so the gateway never sees the key or the plain text. An agent without the key sees "Private", and the MCP instructions tell it to refer to such pots by id and not guess.

The hosted MCP link (`/api/mcp`) runs on Oiko's server, so by design it cannot use the view key. Agents connected that way see "Private".

### 5. Private invoices

Invoices live on Oiko's server, not on chain. With private labels on, the owner's browser encrypts the parts that say *who* and *what* (client name and email, sender name, line descriptions, note) before saving (`apps/web/lib/sealedInvoice.ts`):

| Piece | Holds | Who can open it |
|---|---|---|
| `box` | the real details, encrypted with a fresh 32-byte content key (ChaCha20-Poly1305, bound to the owner's account) | whoever has the content key |
| link `/i/<id>#k=<content key>` | the content key, in the URL fragment | the person the owner sends the link to. Browsers never send the fragment to the server (the PrivateBin and Excalidraw pattern) |
| `keyBox` | the content key sealed with the view key | the owner, on any device, so they can rebuild the link. Never served to payers |
| text fields on the server | Veil tokens where they fit the server's limits, else "Private" | the owner and agents with the view key (exports, `get_invoices`) |

Amounts, quantities, unit prices, currency, dates and status stay readable: the server needs them to quote and match payments. Editing keeps the same content key, so links already sent keep working. The CSV export is downloaded as ciphertext and opened in the browser, with RFC 4180 quoting and the spreadsheet formula guard re-applied (`openCsv`).

## What Veil hides, and what it does not

| Hidden from the public record, RPC nodes and Oiko's server | Still public |
|---|---|
| pot names and icons | amounts and balances (per pot and total; token balances are public on the token contract) |
| bill names | when money moves, and between which accounts |
| agent proposal reasons (when the agent has the key) | pot kinds (Spend, Savings, Locked, Goal, Bills), colors, targets and dates |
| invoice client, email, sender, descriptions and note | the plan's percentages, locks and unlock dates |
| the same labels inside events and activity notes | bill payees, amounts and due days; agent allowlists, caps and names |
| | that an account uses Veil (the 🔒 marker) |

These stay public because the contract has to read them to enforce the rules, and NEAR has no private state. Hiding them needs a different design (next section). The app says this in plain words under Settings → Privacy → "Still public".

Other limits:

- **Key compromise is forever for past labels.** Anyone who gets the view key can read every label sealed with it, including old ones. There is no rotation yet: a new key would mean re-sealing every label. Share the view key only with agents you trust; revoking an agent stops its access to the account but not its knowledge of the key.
- **A malicious front end** can read labels the same way it can already use the app key (`docs/SECURITY.md`, "Front-end compromise").
- **Agent change proposals** (`propose_change`) carry pot and bill names in plain text to the server, because the server checks them against a 32-character limit before the owner approves. The reason is sealed. Once approved, the app seals the name before it reaches the vault.
- **The hosted demo's history.** Labels saved before this change, or with private labels off, are on chain in plain text, and chain history cannot be erased. "Make existing pot names private" changes what the account shows from now on, not past transactions and events.
- Not audited (see `docs/SECURITY.md`).

## Toward private amounts

Hiding amounts and counterparties on NEAR needs zero-knowledge proofs or another execution model. The options we looked at, in order of fit:

1. **Shielded pots.** Per-pot balances as Pedersen commitments with range proofs, verified in the vault, so splits and locks can be checked without revealing amounts. This needs a new vault version, and verifying a proof in Wasm costs a lot of gas.
2. **A shielded pool in front of the vault** (Zcash/Railgun-style notes, or Privacy Pools' association sets for compliance), so incoming payments can't be linked to the payer.
3. **Calimero-style private shards** for the ROSCA groups, whose members already know each other.

Veil is designed so these can come later without changing the label format: tokens are versioned (`oiko-veil/v1`) and the view key is already a separate, shareable read capability.

## References

- qntm, *base32768*: packing binary data into Unicode characters (15 bits per character)
- RFC 8439, ChaCha20 and Poly1305. RFC 5869, HKDF
- Zcash viewing keys; Secret Network viewing keys (read-only capabilities separate from spending keys)
- PrivateBin and Excalidraw: encryption keys in the URL fragment, which the server never receives
- W3C WebAuthn PRF extension (where the owner key, and so the view key, comes from)
