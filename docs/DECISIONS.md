# Oiko — Decisions

## Verified facts (2026-10-30)

How these were checked: live RPC calls (mainnet/testnet), crates.io index plus unpacked crate sources, `npm view` plus unpacked npm tarballs, the 1Click OpenAPI spec (`https://1click.chaindefuser.com/docs/v0/openapi.yaml`) with live calls, and raw GitHub sources. Anything not verified is marked **UNVERIFIED**.

### 1. Rust toolchain, near-sdk, cargo-near, near-workspaces
- **near-sdk**: latest stable is `5.30.0`, with `rust-version = "1.95"` and `[package.metadata.near] min_protocol_version = 88`. The previous release, `5.29.1`, has MSRV `1.93` and `min_protocol_version = 84`.
- **Live protocol versions (RPC `status`)**: mainnet is on **PV 86** (nearcore 2.14.0). Testnet is on **PV 88** (2.14.0-rc.5).
  - So 5.30.0 declares a protocol version that mainnet has not reached yet.
- **Rust ≥1.87 wasm issue**: rustc ≥1.87 emits bulk-memory and nontrapping-float-to-int opcodes. nearcore accepts them from **PV 84** (nearcore 2.12) onward.
  - `cargo-near-build 0.11.5` (`src/near/build/mod.rs`) removes the 1.86 ceiling when the resolved near-sdk declares `min_protocol_version >= 84`.
  - Older SDKs without that metadata are still capped at rustc 1.86.
- **cargo-near**: latest stable is `0.22.0` (it uses cargo-near-build 0.11.5). `0.23.0-rc.2` is a pre-release.
  ```bash
  cargo near build non-reproducible-wasm            # fast local build (--locked optional)
  cargo near build reproducible-wasm                # Docker; reads [package.metadata.near.reproducible_build]
  cargo near build reproducible-wasm --variant <name>
  ```
- **near-workspaces**: `0.24.0`, which depends on `near-sandbox ^0.4.0`. Sandbox `DEFAULT_NEAR_SANDBOX_VERSION = "2.14.0"`.
- Local machine: `rustc 1.89.0`, which is **below the MSRV of both 5.29.x (1.93) and 5.30 (1.95)**.
- Sources: https://index.crates.io/ne/ar/near-sdk , crate tarballs on static.crates.io, https://rpc.mainnet.near.org `status`.
- **Decision**: pin `near-sdk = "=5.29.1"` (PV 84, safe on both networks) and use `rust-toolchain.toml` channel `1.93` or newer with target `wasm32-unknown-unknown`. Build with `cargo near build non-reproducible-wasm` and test with near-workspaces 0.24. Move to 5.30 only after mainnet reaches PV 88.

### 2. Global Contracts (NEP-591)
- **Live**: shipped in nearcore 2.6 at PV 77. Mainnet is at PV 86, testnet at PV 88, and mainnet config shows `wasm_config.global_contract_host_fns: true`. The global-contract host functions arrived in 2.7 at PV 79.
- **Actions**: `DeployGlobalContract { code, deploy_mode: CodeHash | AccountId }` and `UseGlobalContract { contract_identifier: CodeHash(hash) | AccountId(id) }`.
  - Referencing by `AccountId` follows upgrades: the publisher can swap the code.
  - Referencing by `CodeHash` is immutable.
- **near-sdk Promise API** (introduced in **5.17.0**; absent in 5.16.0):
  ```rust
  Promise::new(id).deploy_global_contract(code: impl Into<Vec<u8>>)          // by hash
  Promise::new(id).deploy_global_contract_by_account_id(code)               // by predecessor account id
  Promise::new(id).use_global_contract(code_hash: impl Into<CryptoHash>)    // [u8;32]
  Promise::new(id).use_global_contract_by_account_id(account_id: AccountId)
  ```
  The SDK's own doc example chains creating a subaccount with using the global contract in one batch: `Promise::new(sub).create_account().transfer(amt).use_global_contract_by_account_id(..)`. This is the pattern Oiko needs.
- **near-cli-rs 0.30.1** (verified with `--help` and docs.near.org):
  ```bash
  near contract deploy-as-global use-file app.wasm as-global-account-id <acct> network-config testnet sign-with-keychain send
  near contract deploy-as-global use-file app.wasm as-global-hash <acct> network-config testnet sign-with-keychain send
  near contract deploy <acct> use-global-account-id <publisher> without-init-call network-config testnet ...
  near contract deploy <acct> use-global-hash <hash> without-init-call network-config testnet ...
  ```
- **Cost**: docs say publishing costs 10× the normal storage rate, works out to about 10 NEAR per 100 KB, and the amount is **burned**, not staked.
  - Normal `storage_amount_per_byte` = 1e19 yocto, so global ≈ 1e20 yocto/byte (0.0001 NEAR/byte).
  - A "use" stores only a reference: under 0.001 NEAR.
  - The per-byte value is not exposed in `EXPERIMENTAL_protocol_config`; it comes from docs.
- **near-api-js 7.4.0**:
  ```ts
  actions.deployGlobalContract(code: Uint8Array, mode: 'codeHash'|'accountId')
  actions.useGlobalContract({ accountId } | { codeHash })
  account.deployGlobalContract(code, mode)
  account.useGlobalContract({ accountId })
  ```
- **near-workspaces 0.24**: has **no** deploy-global or use-global helper. Its `Transaction` exposes `add_key/call/delete_key/deploy/transfer` only; global support is limited to reading `ContractState::GlobalHash/GlobalAccountId` in the account view.
  - Sandbox 2.14.0 is a nearcore build containing NEP-591. Whether its genesis runs PV ≥77 is **UNVERIFIED** but near-certain.
- Sources: https://docs.near.org/smart-contracts/global-contracts , near-sdk-5.30.0/src/promise.rs, nearcore 2.6.0 and 2.7.0 release notes.
- **Decision**: publish the vault wasm with `as-global-account-id oiko-code.<net>` from the CLI. The factory creates each user vault as `<user>.oiko.<net>` with `create_account().transfer().add_full_access_key/…().use_global_contract_by_account_id(..).function_call("new",…)` in one batch. Sandbox tests publish through a factory method that calls `deploy_global_contract_by_account_id`, because workspaces has no global helper.

### 3. JS client (near-api-js 7)
- docs.near.org/tools/near-api now says `npm i near-api-js` (alternative: `near-kit`).
- **near-api-js `7.4.0`**:
  - Requires `node >=22.22.2`. Local Node is 22.22.3.
  - Self-contained: its deps are @noble/*, borsh 2 and @scure/base, with no `@near-js/*` dependency.
  - Subpath exports: `near-api-js/tokens`, `/nep413`, `/seed-phrase`, `/rpc-errors`.
- `@near-js/*` packages are at 2.5.1 (legacy modular line). `@hot-labs/near-connect` is 0.12.0; `@near-wallet-selector/core` is 10.1.4.
- Exact API (from the `.d.ts` files):
  ```ts
  import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, nearToYocto, teraToGas } from "near-api-js";
  const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
  const acct = new Account(accountId, provider, signerOrKeyPairString);   // (id, Provider|string, Signer|KeyPairString)
  await acct.signAndSendTransaction({ receiverId, actions: [ ... ], waitUntil?, throwOnFailure?, signer?, retries? });
  // action creators
  actions.createAccount()
  actions.transfer(deposit?: bigint)
  actions.functionCall(methodName, args: object|Uint8Array, gas?: bigint, deposit?: bigint)
  actions.addFunctionCallAccessKey(publicKey: PublicKey, receiverId, methodNames: string[], allowance?: bigint)
  actions.addFullAccessKey(publicKey)
  actions.deleteKey(publicKey)
  actions.useGlobalContract({ accountId } | { codeHash })
  actions.signedDelegate({ delegateAction, signature })
  // Account helpers
  acct.createAccount({ newAccountId, publicKey, nearToTransfer })
  acct.createSubAccount({ accountOrPrefix, publicKey, nearToTransfer })
  acct.addFunctionCallAccessKey({ publicKey, contractId, methodNames?, allowance? })
  acct.deleteKey(pk); acct.getAccessKey(pk); acct.getAccessKeyList(); acct.getState()
  // Meta-tx (NEP-366)
  const { delegateHash, signedDelegate } = await acct.createSignedMetaTransaction({ receiverId, actions, blockHeightTtl?, signer? });
  // relayer side:
  await relayerAcct.relayMetaTransaction(signedDelegate);
  // or: relayerAcct.signAndSendTransaction({ receiverId: signedDelegate.delegateAction.senderId, actions: [actions.signedDelegate(signedDelegate)] })
  // encodeSignedDelegate(sd) is available for borsh-transport to a relayer
  // Provider views
  provider.viewAccessKey({ accountId, publicKey, finality? })
  provider.viewAccessKeyList({ accountId, finality? })
  provider.viewAccount({ accountId })
  provider.callFunction({ contractId, method, args })
  ```
- **Function-call keys signing delegate actions**: allowed with constraints, per nearcore `runtime/runtime/src/actions.rs::validate_delegate_action_key`.
  - The delegate must contain **exactly 1** action, and it must be `FunctionCall`. Otherwise it fails with `RequiresFullAccess`.
  - `deposit == 0`, or it fails with `DepositWithFunctionCall`. So **no 1-yocto calls** (e.g. `ft_transfer`) through a function-call-key delegate.
  - `delegate.receiver_id == key.receiver_id`, and the method must be in `method_names` (or the list is empty).
  - The nonce must be greater than the key nonce.
  - The relayer pays the gas, so the key's allowance is not consumed.
- **Decision**: use `near-api-js@7.4.0` everywhere (server and relayer). Session keys are function-call keys scoped to the user's vault contract with no deposit-needing methods. Anything that needs 1 yocto (ft_transfer, Rhea `execute`) must run inside the vault contract, triggered by a zero-deposit method.

### 4. NEP-413 message signing
- From the near-api-js 7.4.0 `nep413` module source:
  ```ts
  // borsh schema
  { struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } } }
  // hash = sha256( borsh_u32_le(2147484061 /* 2**31 + 413 */) || borsh(payload) ); signature = ed25519.sign(hash)
  ```
- Built-in helpers:
  ```ts
  import { signMessage, verifyMessage } from "near-api-js/nep413";
  await verifyMessage({ signerAccountId, signerPublicKey, payload: { message, recipient, nonce, callbackUrl? }, signature: Uint8Array, provider });
  ```
  - `verifyMessage` throws unless the key is **FullAccess** on that account, and checks this via `viewAccessKey`.
  - `acct.signNep413Message({ message, recipient, nonce, callbackUrl })` returns `{ accountId, publicKey, signature, state? }`.
- Manual check: `ed25519.verify(sig, sha256(prefix||borsh), pubkey32)` from `@noble/curves/ed25519.js` (v2.4.0), where `pubkey32` is the base58-decoded `ed25519:` key.
- **Decision**: verify on the server with `near-api-js/nep413` `verifyMessage`, which includes the full-access check. Use a 32-byte random nonce stored server-side for single use, and set `recipient = "oiko.app"` (or the deployed domain).

### 5. NEAR Intents 1Click API (`https://1click.chaindefuser.com`)
- **Endpoints**:
  - `GET /v0/tokens`
  - `POST /v0/quote`
  - `GET /v0/status?depositAddress=&depositMemo=`
  - `POST /v0/deposit/submit` with body `{ txHash, depositAddress, nearSenderAccount?, memo? }`
  - also `/v0/any-input/withdrawals`, `/v0/generate-intent`, `/v0/submit-intent`, `/v0/orders`
- **Auth**: optional. Send `X-API-Key: <partner JWT>` (or `Authorization: Bearer`).
  - Docs (authentication.md, fetched today): unauthenticated requests incur an extra **0.25% (25 bps)** platform fee. Authenticated requests use the partner schedule, typically 20 bps, or **1 bp on stablecoin / same-asset routes**.
  - My unauthenticated dry quote, though, echoed only `appFees:[{recipient:"5880ad…47dd", fee:1}]`, and 200 USDT in returned 199.974779 out. That **does not** look like 25 bps was applied. Treat fee behaviour as observed-not-guaranteed.
  - JWTs come from https://partners.near-intents.org.
- **QuoteRequest**:
  - Required fields: `dry:boolean`, `swapType: EXACT_INPUT|EXACT_OUTPUT|FLEX_INPUT|ANY_INPUT`, `slippageTolerance:number(bps)`, `originAsset`, `depositType: ORIGIN_CHAIN|INTENTS|CONFIDENTIAL_INTENTS`, `destinationAsset`, `amount:string(base units)`, `refundTo`, `refundType: ORIGIN_CHAIN|INTENTS|CONFIDENTIAL_INTENTS`, `recipient`, `recipientType: DESTINATION_CHAIN|INTENTS|CONFIDENTIAL_INTENTS`, `deadline: ISO string`.
  - Optional fields: `depositMode: SIMPLE|MEMO`, `connectedWallets[]`, `sessionId`, `virtualChainRecipient`, `virtualChainRefundRecipient`, `customRecipientMsg` (makes the NEAR withdrawal use `ft_transfer_call` with this msg), `confidentiality: public|basic|advanced`, `referral`, `rebates[]`, `quoteWaitingTimeMs`, `appFees: [{recipient, fee(bps)}]`, `insured` (+2 bps).
- **QuoteResponse**: `{ correlationId, timestamp, signature, quoteRequest, quote }`.
  - `quote` = `{ depositAddress?, depositMemo?, chainDepositAddresses?, amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut, amountOutFormatted, amountOutUsd, minAmountOut, deadline?, timeWhenInactive?, timeEstimate(s), refundFee?, withdrawFee? }`.
  - With `dry:true` there is no `depositAddress`, `deadline` or `timeWhenInactive`.
- **Status enum**: `KNOWN_DEPOSIT_TX | PENDING_DEPOSIT | INCOMPLETE_DEPOSIT | PROCESSING | SUCCESS | REFUNDED | FAILED`. The response is `{ correlationId, quoteResponse, status, updatedAt, swapDetails }`.
- **Token shape**: `{ assetId, decimals, blockchain, symbol, price, priceUpdatedAt, contractAddress?, coingeckoId? }`. 210 tokens were listed today.

| chain | USDC assetId | USDT assetId |
|---|---|---|
| near | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6) | `nep141:usdt.tether-token.near` (6) |
| tron | — (none) | `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` (6) |
| eth | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near` |
| base | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | — (none) |
| arb | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` | `nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near` (symbol **USDT0**) |
| sol | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | `nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near` |
| bsc | `nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r` (**18 dec**) | `nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g` (**18 dec**) |
| pol | `nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L` | `nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr` |

All decimals are 6 unless marked.
- **Live dry quotes, without a key**:
  - 5 USDT tron→near was rejected: `{"message":"Temporary swap limits: minimum swap amount is $100", ...}`. 100 USDT got the same rejection.
  - With the sample refund address (the USDT contract address), 150 USDT returned `Internal server error`.
  - 200 USDT with a real wallet-style refund address (`TLa2f6…`) and recipient `aurora.near` returned `quote:{amountIn:"200000000", amountOut:"199974779", minAmountOut:"197975031", timeEstimate:80, refundFee:"898996", withdrawFee:"5405", ...}`, along with `signature:"ed25519:…"`, `correlationId` and the echoed `quoteRequest`.
  - An invalid `refundTo` returns `400 "refundTo is not valid"`.
- **Decision**: route deposits through 1Click with `depositType: ORIGIN_CHAIN`, `recipientType: DESTINATION_CHAIN`, `recipient = <user vault>`, `customRecipientMsg` only if the vault needs `ft_on_transfer`, and slippage 50–100 bps.
  - The UI must enforce the current **$100 minimum**; re-check it at demo time.
  - Get a partner JWT for fee certainty and store the quote `signature`.
  - Poll `/v0/status` and call `/v0/deposit/submit` after the user sends funds.

### 6. Stablecoin contract IDs
- **Mainnet** (`ft_metadata` verified):
  - Native USDC: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (symbol USDC, 6 dec).
  - Native USDt: `usdt.tether-token.near` (symbol USDt, 6 dec).
- **Testnet**:
  - Circle USDC **exists**: `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (symbol USDC).
  - USDt-like tokens: `usdtt.fakes.testnet` (USDt, listed on Rhea testnet) and `tt_local.testnet` (TetherToken / USDt).
  - Bridged-style fakes: `usdc.fakes.testnet` (USDC.e) and `usdt.fakes.testnet` (USDT.e).
  - `usdt.tether-token.testnet` does **not** exist.
- Whether Circle's faucet dispenses NEAR-testnet USDC is **UNVERIFIED**.
- **Decision**: config map `{ mainnet: {USDC: 17208628…, USDT: usdt.tether-token.near}, testnet: {USDC: 3e2210e1…, USDT: usdtt.fakes.testnet} }`.

### 7. Rhea (formerly Burrow) lending
- **Mainnet**: `contract.main.burrow.near`, `get_version` = `"0.16.2"`. Config: `enable_pyth_oracle:true`, `enable_price_oracle:false`, `oracle_account_id: priceoracle.near`, `pyth_oracle_account_id: aggregate-oracle.near`.
- **Testnet**: `contract.burrow.testnet` (v0.11.0). Its assets include `3e2210e1…` (Circle USDC), `usdtt.fakes.testnet`, `usdc.fakes.testnet`, `usdt.fakes.testnet` and `wrap.testnet`. There is also an old `contract.1638481328.burrow.testnet` at v0.8.0.
- Source: https://github.com/ref-finance/burrowland (not archived, main at 0.15.7 — slightly behind the deployed 0.16.2). The NearDeFi repo is archived.
- **Views**:
  - `get_asset({token_id})` returns the shape below.
  - `get_assets_paged({from_index?, limit?})` returns `[[token_id, AssetView-without-apr?], ...]`. The paged entries seen had no `supply_apr`, so use `get_asset` for APR.
  - `get_account({account_id})` returns `null` if the account is not registered.
  ```json
  { "token_id": "...", "supplied": {"shares":"…","balance":"…"}, "borrowed": {"shares":"…","balance":"…"},
    "margin_debt": {...}, "reserved": "…", "prot_fee": "…", "last_update_timestamp": "ns",
    "config": { "reserve_ratio":2500, "target_utilization":8000, "extra_decimals":12, "can_deposit":true, "can_withdraw":true,
                "can_use_as_collateral":true, "can_borrow":true, "supplied_limit":"…", "borrowed_limit":"…", ... },
    "supply_apr": "0.1383…", "borrow_apr": "0.2075…", "farms": [...] }
  ```
  - Balances are in **inner decimals = token decimals + extra_decimals** (6+12 = 18 for USDC/USDt).
  - APR is a decimal fraction string (0.138 = 13.8%).
  - Today: USDC supplied ≈ 12.65M, borrowed ≈ 11.25M; USDt supplied ≈ 12.17M.
- **Storage**: `storage_deposit({})` on the lending contract. `storage_balance_bounds` = `{min:"100000000000000000000000"}` (0.1 NEAR).
- **Supply**: `ft_transfer_call{receiver_id: contract.main.burrow.near, amount, msg: ""}` with 1 yocto attached.
  - An empty msg means supply only, not collateral. To add collateral in the same call: `msg: "{\"Execute\":{\"actions\":[{\"IncreaseCollateral\":{\"token_id\":\"…\"}}]}}"`.
  - Other msg variants: `ExecuteWithPyth`, `DepositToReserve`, `OnlyIncreaseCollateral`, `OnlyRepay`, among others.
- **Withdraw**:
  ```json
  execute({"actions":[{"Withdraw":{"token_id":"<ft>","amount":null|"<inner-decimal U128>","max_amount":null|"…"}}]})
  ```
  - Requires exactly **1 yocto**.
  - Plain `execute` uses `Prices::new()` (no oracle), and README says "Withdrawing doesn't need oracle prices" for supplied (non-collateral) balances. So pure supply withdrawals need **neither** `execute_with_pyth` nor `oracle_call`.
  - `amount: null` means withdraw the maximum.
  - Alternative: `simple_withdraw(token_id, amount_with_inner_decimal, recipient_id?)` with 1 yocto. It also decreases collateral if needed.
- **Decision**:
  - The vault contract calls `storage_deposit` once (0.1 NEAR) and supplies with `ft_transfer_call` plus an empty msg.
  - It withdraws with `execute([Withdraw{token_id, amount:<6dec×1e12>}])` and 1 yocto, then reads `get_asset` for the APR display.
  - It never posts collateral.

### 8. Chain Signatures (MPC)
- **Contracts**: mainnet `v1.signer` (`version()` = `"3.17.0"`), testnet `v1.signer-prod.testnet`.
- **sign** (from the near/mpc contract README):
  ```json
  sign({"request":{"payload_v2":{"Ecdsa":"<hex 32 bytes>"},"path":"ethereum-1","domain_id":0}})
  // Eddsa: {"Eddsa":"<hex 32..1232 bytes>"}, domain_id 1
  ```
  - Legacy `payload` (array of 32 ints) and `key_version` (= domain_id) are still accepted.
  - Deposit: at least **1 yocto**; the excess is refunded. Gas: at least **10 Tgas** attached (~7 used).
  - The response is `{big_r, s, recovery_id}`.
- **Views**: `public_key({domain_id?})` and `derived_public_key({path, predecessor?, domain_id?})`.
  - Mainnet root key (domain 0): `secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya`.
  - Testnet root key: `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3`.
- **KDF** (`near/mpc crates/near-mpc-crypto-types/src/kdf.rs`). I checked it off-chain against the contract's `derived_public_key` for `example.near` + `ethereum-1`, and the two outputs matched exactly.
  ```ts
  tweak = sha3_256(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`)   // SHA3-256, not keccak
  derived = G * BigInt(tweak) + RootPoint            // secp256k1
  evmAddress = '0x' + hex(keccak_256(uncompressed(derived).slice(1)).slice(12))
  // root b58 decodes to 64 bytes (x||y); prefix 0x04 to parse
  ```
  The docs.near.org example address (`0x1b48…` for example.near/ethereum-1) does **not** match the current mainnet key. Mine gives `0xef4ea05e…1fa5`.
- **Decision**: derive EVM deposit addresses off-chain with @noble/curves + @noble/hashes using the formula above, and sanity-check them once against `derived_public_key`. Only call `sign` (1 yocto, 10+ Tgas) when actually needed. MPC is optional for the MVP, since 1Click covers cross-chain.

### 9. MCP
- **`@modelcontextprotocol/sdk` 1.32.2** (latest v1). `LATEST_PROTOCOL_VERSION = '2025-11-25'`. Requires node ≥18 and peer `zod ^3.25 || ^4`.
  ```ts
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
  import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"; // Node req/res
  // also WebStandardStreamableHTTPServerTransport in server/webStandardStreamableHttp.js (fetch Request/Response)
  const server = new McpServer({ name: "oiko", version: "0.1.0" });
  server.registerTool("get_balance", { title, description, inputSchema: { accountId: z.string() } }, async (args) => ({ content: [{ type: "text", text: "…" }] }));
  await server.connect(new StdioServerTransport());
  // HTTP: const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined /* stateless */ }); await server.connect(t); await t.handleRequest(req, res, req.body);
  ```
- **The v2 split packages now exist**:
  - `@modelcontextprotocol/server` 2.4.0 (zod ^4.2, node ≥20): exports `McpServer` and `WebStandardStreamableHTTPServerTransport`, plus `StdioServerTransport` from `@modelcontextprotocol/server/stdio`.
  - `@modelcontextprotocol/node` 2.1.2: `NodeStreamableHTTPServerTransport`.
  - Also `@modelcontextprotocol/client` and `@modelcontextprotocol/core` 2.4.0, and `@modelcontextprotocol/express` 2.0.2.
- **Spec**: modelcontextprotocol.io/specification/versioning says the **current version is `2026-07-28`**. It is stateless: per-request `_meta` `io.modelcontextprotocol/protocolVersion` plus `server/discover`. Earlier handshake versions are ≤`2025-11-25`. v2 core references 2026-07-28; v1.32.2 tops out at 2025-11-25.
- **Decision**: use `@modelcontextprotocol/sdk@1.32.2` (stable, widely documented; stdio for Claude Desktop/Code, Streamable HTTP stateless for remote). Consider v2 `@modelcontextprotocol/server` only if 2026-07-28 features are needed.

### 10. Testnet accounts and RPC
- **Faucet account creation, non-interactive** (near-cli-rs GUIDE.en.md; local CLI is 0.30.1):
  ```bash
  near account create-account sponsor-by-faucet-service oiko.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
  # or: use-manually-provided-seed-phrase '<12 words>' / use-manually-provided-public-key ed25519:... ; save-to-legacy-keychain for ~/.near-credentials
  ```
- **Availability** (`view_account`, today):
  - `oiko.testnet` returns **UNKNOWN_ACCOUNT**, so it is available.
  - `oiko.near` on mainnet returns **UNKNOWN_ACCOUNT**, so it is unregistered. A top-level `.near` name under 32 characters needs registrar/`near` account creation; plain create from another account is not possible.
- **RPC**: `https://rpc.testnet.near.org`, `https://test.rpc.fastnear.com`, `https://rpc.mainnet.near.org` and `https://rpc.mainnet.fastnear.com` all respond.
  - docs.near.org examples use `https://test.rpc.fastnear.com`.
- **Decision**: create `oiko.testnet` through the faucet. The factory is `oiko.testnet`, and user vaults are `<name>.oiko.testnet`. Default RPC is fastnear, with near.org as fallback.

### 11. Framework7 Icons
- `framework7-icons@5.0.5`, licence **MIT**.
- It ships individual SVGs at **`node_modules/framework7-icons/svg/<name>.svg`** (1252 files, 56×56 viewBox, single path), with `_fill` variants.
- All of these were confirmed present: `arrow_down_circle_fill`, `arrow_up_circle_fill`, `arrow_right_arrow_left`, `ellipsis`, `lock_fill`, `lock_open_fill`, `chart_bar_fill`, `person_2_fill`, `bolt_fill`, `house_fill`, `gear_alt_fill`, `plus_circle_fill`, `qrcode`, `doc_on_doc_fill`, `checkmark_circle_fill`, `xmark`, `arrow_2_circlepath`, `clock_fill`, `shield_lefthalf_fill`, `bell_fill`, `creditcard_fill`, `money_dollar_circle_fill`, `sparkles`, `chevron_right`, `arrow_down_to_line`, `arrow_up_right`.
- It also has a React build at `framework7-icons/react` (PascalCase, e.g. `LockFill`, `Arrow2Circlepath`), plus a font and CSS (`css/framework7-icons.css`).
- **Decision**: import the raw SVGs (`framework7-icons/svg/*.svg`) through SVGR or inline them into an `<Icon name>` component. Do not load the icon font.

### 12. Frontend stack
- `next@16.4.3`: engines `node >=20.9.0`, React `^18.2 || ^19`.
- `tailwindcss@4.3.3` (v4 stable) with `@tailwindcss/postcss` 4.3.3.
- `motion@14.9.0`: peers react/react-dom `^18 || ^19`; import from `motion/react`.
- `@noble/curves@2.4.0`.
- Effective Node floor is **22.22.2**, because of near-api-js 7.
- **Decision**: Node 22 LTS (≥22.22.2) with Next 16 App Router, Tailwind 4 and motion 14.
