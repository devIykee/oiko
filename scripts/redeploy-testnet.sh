#!/usr/bin/env bash
# Redeploys the Oiko registry (on ROOT) and ajo (ajo.ROOT) on NEAR testnet with the current
# contracts/res/*.wasm, publishes the new vault global contract, and (only with --lock) makes
# ROOT and ajo.ROOT keyless.
#
#   bash scripts/redeploy-testnet.sh          # safe to re-run; skips finished steps
#   bash scripts/redeploy-testnet.sh --lock   # after you've checked the app: delete full-access keys
#
# Old state can't be read by the new code (borsh layouts changed), so each contract account gets
# the testnet-only `oiko_state_wipe.wasm` first, every storage key is removed, then the new wasm is
# deployed with its init call. Registered names are NOT carried over: existing <name>.ROOT accounts
# and their old vaults keep working on the old code, but the new registry doesn't list them.
#
# Prereqs: near-cli-rs, python3, curl, keys for ROOT, ajo.ROOT, usdc/usdt/lending.ROOT in
# ~/.near-credentials (legacy keychain), and built wasm (bash scripts/build-contracts.sh).
set -euo pipefail

LOCK=0
[ "${1:-}" = "--lock" ] && LOCK=1

ROOT=${ROOT:-oiko.testnet}
RELAYER=${RELAYER:-oiko-relayer.testnet}
RPC=${RPC:-https://rpc.testnet.fastnear.com}
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
RES="$(cd "$(dirname "$0")/.." && pwd)/contracts/res"
ACCOUNT_FUNDING=${ACCOUNT_FUNDING:-600000000000000000000000}   # 0.6 NEAR per signup on testnet
MPC=${MPC:-v1.signer-prod.testnet}
USDC="usdc.$ROOT"; USDT="usdt.$ROOT"; LENDING="lending.$ROOT"; AJO="ajo.$ROOT"
GAS_BUFFER_NEAR=${GAS_BUFFER_NEAR:-0.5}   # kept on each account for gas and registry refunds

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mABORT: %s\033[0m\n' "$*" >&2; exit 1; }

for w in oiko_vault oiko_registry oiko_ajo oiko_mock_ft oiko_mock_lending oiko_state_wipe; do
  [ -f "$RES/$w.wasm" ] || die "missing $RES/$w.wasm — run: bash scripts/build-contracts.sh"
done
command -v near >/dev/null || die "near-cli-rs not found"

# ---------------------------------------------------------------------------------------------
# RPC helper (read-only): python3 rpc.py <cmd> <args...>
# ---------------------------------------------------------------------------------------------
PY="$(cd "$(dirname "$0")" && pwd)/near-rpc.py"
rpc() { python3 "$PY" "$RPC" "$@"; }
calc() { python3 -c "print($1)"; }   # big-integer arithmetic (yocto doesn't fit in bash ints)

HASH=$(rpc hash "$RES/oiko_vault.wasm")
REG_HASH=$(rpc hash "$RES/oiko_registry.wasm")
AJO_HASH=$(rpc hash "$RES/oiko_ajo.wasm")
WIPE_HASH=$(rpc hash "$RES/oiko_state_wipe.wasm")
BYTE=10000000000000000000          # 1e19 yocto per byte of storage
GLOBAL_BYTE=100000000000000000000  # 1e20 yocto per byte of a global contract (burned)
BUF=$(rpc yocto "$GAS_BUFFER_NEAR")

# ---------------------------------------------------------------------------------------------
step "1/8 Balance check (read-only)"
# ---------------------------------------------------------------------------------------------
[ "$(rpc exists "$ROOT")" = 1 ] || die "$ROOT does not exist"
[ "$(rpc exists "$AJO")" = 1 ] || die "$AJO does not exist (run scripts/deploy-testnet.sh for a fresh setup)"
PUBLISHED=$(rpc global_exists "$HASH")
PUBLISH_COST=0
[ "$PUBLISHED" = 1 ] || PUBLISH_COST=$(calc "$(rpc size "$RES/oiko_vault.wasm") * $GLOBAL_BYTE")
# after redeploy each account stores roughly its new code + 2 KB of state
ROOT_NEED=$(calc "$PUBLISH_COST + ($(rpc size "$RES/oiko_registry.wasm") + 2000) * $BYTE + $BUF")
AJO_NEED=$(calc "($(rpc size "$RES/oiko_ajo.wasm") + 2000) * $BYTE + $BUF")
SHORT=0
for pair in "$ROOT:$ROOT_NEED" "$AJO:$AJO_NEED"; do
  acc=${pair%%:*}; need=${pair##*:}; have=$(rpc balance "$acc")
  printf '  %-26s has %10s NEAR, needs %10s NEAR\n' "$acc" "$(rpc near "$have")" "$(rpc near "$need")"
  if [ "$(calc "int($have < $need)")" = 1 ]; then
    printf '  \033[31m-> send at least %s NEAR to %s\033[0m\n' "$(rpc near "$(calc "$need - $have")")" "$acc"; SHORT=1
  fi
done
RB=$(rpc balance "$RELAYER")
printf '  %-26s has %10s NEAR (each signup costs ~%s NEAR + gas)\n' "$RELAYER" "$(rpc near "$RB")" "$(rpc near "$ACCOUNT_FUNDING")"
[ "$PUBLISHED" = 1 ] && echo "  vault global contract $HASH already published (no publish cost)" \
  || echo "  publishing the vault globally burns $(rpc near "$PUBLISH_COST") NEAR (paid by $ROOT)"
[ "$SHORT" = 0 ] || die "fund the accounts above, then re-run"

# ---------------------------------------------------------------------------------------------
step "2/8 Publish the vault as a global contract by code hash: $HASH"
# ---------------------------------------------------------------------------------------------
if [ "$PUBLISHED" = 1 ]; then echo "  already published — skipping"; else
  near contract deploy-as-global use-file "$RES/oiko_vault.wasm" as-global-hash "$ROOT" $NET $SIGN
  [ "$(rpc global_exists "$HASH")" = 1 ] || echo "  (RPC can't confirm yet; continuing — re-run to re-check)"
fi

wipe_and_deploy() { # <account> <wasm> <expected hash> <init json> <verify-cmd>
  local acc="$1" wasm="$2" want="$3" init="$4"
  if [ "$(rpc code_hash "$acc")" = "$want" ] && eval "$5" >/dev/null 2>&1; then
    echo "  $acc already runs $wasm ($want) and is initialised — skipping"; return
  fi
  if [ "$(rpc code_hash "$acc")" != "$WIPE_HASH" ]; then
    echo "  deploying state-wipe tool on $acc"
    near contract deploy "$acc" use-file "$RES/oiko_state_wipe.wasm" without-init-call $NET $SIGN >/dev/null
  fi
  local n; n=$(rpc keys "$acc" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
  echo "  $acc has $n storage keys; wiping in batches of 100"
  rpc batches "$acc" 100 | while read -r args; do
    near contract call-function as-transaction "$acc" wipe json-args "$args" prepaid-gas '300.0 Tgas' \
      attached-deposit '0 NEAR' sign-as "$acc" $NET $SIGN >/dev/null
    echo "    wiped a batch"
  done
  n=$(rpc keys "$acc" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
  [ "$n" = 0 ] || die "$acc still has $n storage keys after wipe; re-run"
  echo "  deploying $wasm on $acc with init"
  near contract deploy "$acc" use-file "$RES/$wasm" with-init-call new json-args "$init" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN >/dev/null
}

# ---------------------------------------------------------------------------------------------
step "3/8 Registry on $ROOT"
# ---------------------------------------------------------------------------------------------
REG_INIT="{\"vault_code_hash\":\"$HASH\",\"usdc\":\"$USDC\",\"usdt\":\"$USDT\",\"lending\":\"$LENDING\",\"ajo\":\"$AJO\",\"mpc_signer\":\"$MPC\",\"relayer\":\"$RELAYER\",\"account_funding\":\"$ACCOUNT_FUNDING\"}"
wipe_and_deploy "$ROOT" oiko_registry.wasm "$REG_HASH" "$REG_INIT" \
  "rpc view $ROOT config '{}' | grep -q '\"vault_code_hash\":\"$HASH\"'"

# ---------------------------------------------------------------------------------------------
step "4/8 Ajo on $AJO (short-periods build: 60 s rounds)"
# ---------------------------------------------------------------------------------------------
wipe_and_deploy "$AJO" oiko_ajo.wasm "$AJO_HASH" "{\"usdc\":\"$USDC\",\"usdt\":\"$USDT\"}" \
  "rpc view $AJO next_circle_id '{}' >/dev/null"

# ---------------------------------------------------------------------------------------------
step "5/8 Mocks (code-only redeploy if the wasm differs; sources/state layout unchanged)"
# ---------------------------------------------------------------------------------------------
for pair in "$USDC:oiko_mock_ft.wasm" "$USDT:oiko_mock_ft.wasm" "$LENDING:oiko_mock_lending.wasm"; do
  acc=${pair%%:*}; wasm=${pair##*:}; want=$(rpc hash "$RES/$wasm"); have=$(rpc code_hash "$acc")
  if [ "$have" = "$want" ]; then echo "  $acc up to date ($have)"; else
    echo "  $acc runs $have, res has $want -> redeploying code (no init; state kept)"
    near contract deploy "$acc" use-file "$RES/$wasm" without-init-call $NET $SIGN >/dev/null
  fi
done

# ---------------------------------------------------------------------------------------------
step "6/8 Register $AJO on the mock tokens (needed to receive contributions)"
# ---------------------------------------------------------------------------------------------
for t in "$USDC" "$USDT"; do
  if [ "$(rpc view "$t" storage_balance_of "{\"account_id\":\"$AJO\"}")" = "null" ]; then
    near contract call-function as-transaction "$t" storage_deposit json-args "{\"account_id\":\"$AJO\",\"registration_only\":true}" \
      prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$AJO" $NET $SIGN >/dev/null
    echo "  registered $AJO on $t"
  else echo "  $AJO already registered on $t"; fi
done

# ---------------------------------------------------------------------------------------------
step "7/8 Verify"
# ---------------------------------------------------------------------------------------------
CFG=$(rpc view "$ROOT" config '{}')
echo "$CFG" | grep -q "\"vault_code_hash\":\"$HASH\"" || die "registry config().vault_code_hash != $HASH: $CFG"
echo "  registry config().vault_code_hash == $HASH"
echo "  registry stats(): $(rpc view "$ROOT" stats '{}')"
NEXT=$(rpc view "$AJO" next_circle_id '{}')
[ "$NEXT" = 1 ] || echo "  note: ajo next_circle_id = $NEXT (expected 1 right after redeploy; >1 means circles were already created)"
[ "$NEXT" = 1 ] && echo "  ajo next_circle_id == 1"
for acc in "$ROOT" "$AJO" "$USDC" "$USDT" "$LENDING"; do printf '  %-26s code %s\n' "$acc" "$(rpc code_hash "$acc")"; done

# ---------------------------------------------------------------------------------------------
step "8/8 Lock (delete full-access keys)"
# ---------------------------------------------------------------------------------------------
if [ "$LOCK" = 1 ]; then
  cat <<EOF

  ###########################################################################################
  #  WARNING: this deletes EVERY full-access key on $ROOT and $AJO.
  #  After this NOBODY can change, upgrade, wipe or redeploy these contracts, or move the NEAR
  #  they hold — not you, not Oiko. Only proceed after testing signup, receive, ROSCA on the app.
  ###########################################################################################
EOF
  read -r -p "  Type LOCK $ROOT to continue: " answer
  [ "$answer" = "LOCK $ROOT" ] || die "not confirmed"
  for acc in "$ROOT" "$AJO"; do
    keys=$(rpc full_keys "$acc" | paste -sd, -)
    if [ -z "$keys" ]; then echo "  $acc is already keyless"; continue; fi
    near account delete-keys "$acc" public-keys "$keys" $NET $SIGN >/dev/null
    echo "  deleted full-access keys on $acc"
    [ -z "$(rpc full_keys "$acc")" ] && echo "  $acc is now keyless"
  done
else
  echo "  skipped. After you've checked the app, run: bash scripts/redeploy-testnet.sh --lock"
fi

cat <<EOF

Set these env vars (Vercel + .env), then redeploy the app:
OIKO_NETWORK=testnet
OIKO_ROOT_ACCOUNT=$ROOT
OIKO_USDC=$USDC
OIKO_USDT=$USDT
OIKO_LENDING=$LENDING
OIKO_AJO=$AJO
OIKO_MPC_SIGNER=$MPC
OIKO_VAULT_CODE_HASH=$HASH
RELAYER_ACCOUNT_ID=$RELAYER
EOF
