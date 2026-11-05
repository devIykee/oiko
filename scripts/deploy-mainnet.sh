#!/usr/bin/env bash
# Fresh Oiko deployment on NEAR MAINNET. Human-run only: it spends real NEAR, asks you to type the
# root account name before the first transaction, and refuses to run without a terminal.
#
#   ROOT=oiko.near RELAYER=oiko-relayer.near bash scripts/deploy-mainnet.sh
#   ROOT=oiko.near bash scripts/deploy-mainnet.sh --lock     # later: make ROOT and ajo.ROOT keyless
#
# What it does (each step is skipped if already done):
#   1. prints the full cost estimate and checks ROOT's balance
#   2. publishes the vault wasm as a global contract by code hash (cost is burned)
#   3. creates ajo.ROOT and deploys the mainnet ajo build (1-day minimum period)
#   4. registers ajo.ROOT on USDC and USDt (storage_deposit)
#   5. deploys the registry on ROOT with its init call
#   6. verifies with views and prints the env block
#   7. only with --lock: deletes every full-access key on ROOT and ajo.ROOT
# No mocks on mainnet: real USDC, USDt, Rhea (Burrow) lending and the v1.signer MPC contract.
# Prereqs: near-cli-rs, python3, ROOT's full-access key in ~/.near-credentials/mainnet (legacy
# keychain), built wasm (bash scripts/build-contracts.sh). ROOT must already exist and be funded.
set -euo pipefail

LOCK=0
[ "${1:-}" = "--lock" ] && LOCK=1

ROOT=${ROOT:-oiko.near}
RELAYER=${RELAYER:-oiko-relayer.near}
RPC=${RPC:-https://rpc.mainnet.fastnear.com}
NET="network-config mainnet"
SIGN="sign-with-legacy-keychain send"
RES="$(cd "$(dirname "$0")/.." && pwd)/contracts/res"
ACCOUNT_FUNDING_NEAR=${ACCOUNT_FUNDING_NEAR:-1.5}   # per signup (docs/DECISIONS.md funding numbers)
SIGNUPS=${SIGNUPS:-20}                              # for the relayer estimate only
USDC=${USDC:-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1}
USDT=${USDT:-usdt.tether-token.near}
LENDING=${LENDING:-contract.main.burrow.near}
MPC=${MPC:-v1.signer}
AJO="ajo.$ROOT"
AJO_FUNDING_NEAR=${AJO_FUNDING_NEAR:-2.4}
GAS_BUFFER_NEAR=${GAS_BUFFER_NEAR:-0.8}             # gas for ~10 transactions + registry refund float

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mABORT: %s\033[0m\n' "$*" >&2; exit 1; }

[ -t 0 ] && [ -t 1 ] || die "this script must be run by a person in a terminal (no CI, no pipes)"
for w in oiko_vault oiko_registry oiko_ajo_mainnet; do
  [ -f "$RES/$w.wasm" ] || die "missing $RES/$w.wasm — run: bash scripts/build-contracts.sh"
done
command -v near >/dev/null || die "near-cli-rs not found"
PY="$(cd "$(dirname "$0")" && pwd)/near-rpc.py"
rpc() { python3 "$PY" "$RPC" "$@"; }
calc() { python3 -c "print($1)"; }

HASH=$(rpc hash "$RES/oiko_vault.wasm")
REG_HASH=$(rpc hash "$RES/oiko_registry.wasm")
AJO_HASH=$(rpc hash "$RES/oiko_ajo_mainnet.wasm")
BYTE=10000000000000000000
GLOBAL_BYTE=100000000000000000000
ACCOUNT_FUNDING=$(rpc yocto "$ACCOUNT_FUNDING_NEAR")

# ---------------------------------------------------------------------------------------------
step "1/7 Cost estimate (read-only)"
# ---------------------------------------------------------------------------------------------
[ "$(rpc exists "$ROOT")" = 1 ] || die "$ROOT does not exist on mainnet; create and fund it first"
PUBLISHED=$(rpc global_exists "$HASH")
PUBLISH=0; [ "$PUBLISHED" = 1 ] || PUBLISH=$(calc "$(rpc size "$RES/oiko_vault.wasm") * $GLOBAL_BYTE")
REG=$(calc "($(rpc size "$RES/oiko_registry.wasm") + 2000) * $BYTE")
AJO_COST=0; [ "$(rpc exists "$AJO")" = 1 ] || AJO_COST=$(rpc yocto "$AJO_FUNDING_NEAR")
BUF=$(rpc yocto "$GAS_BUFFER_NEAR")
TOTAL=$(calc "$PUBLISH + $REG + $AJO_COST + $BUF")
RELAYER_NEED=$(calc "$SIGNUPS * ($ACCOUNT_FUNDING + 50000000000000000000000)")
HAVE=$(rpc balance "$ROOT")
cat <<EOF
  vault code hash              $HASH ($(rpc size "$RES/oiko_vault.wasm") bytes)
  publish vault globally       $(rpc near "$PUBLISH") NEAR (burned; 0 if already published)
  registry storage on $ROOT    $(rpc near "$REG") NEAR (staked)
  create + fund $AJO           $(rpc near "$AJO_COST") NEAR (ajo code storage ~2.0 + gas)
  gas + refund float           $(rpc near "$BUF") NEAR
  ------------------------------------------------------------------
  TOTAL needed on $ROOT        $(rpc near "$TOTAL") NEAR   (has $(rpc near "$HAVE") NEAR)

  Separately, the relayer $RELAYER pays $ACCOUNT_FUNDING_NEAR NEAR + gas per signup:
  $SIGNUPS signups ≈ $(rpc near "$RELAYER_NEED") NEAR (has $(rpc near "$(rpc balance "$RELAYER")") NEAR).

  Tokens: USDC=$USDC  USDt=$USDT
  Lending: $LENDING   MPC signer: $MPC
EOF
if [ "$LOCK" = 0 ]; then
  [ "$(calc "int($HAVE >= $TOTAL)")" = 1 ] || die "send at least $(rpc near "$(calc "$TOTAL - $HAVE")") NEAR to $ROOT first"
  echo
  read -r -p "  This spends real NEAR on MAINNET. Type the root account name ($ROOT) to continue: " answer
  [ "$answer" = "$ROOT" ] || die "not confirmed"

  # -------------------------------------------------------------------------------------------
  step "2/7 Publish the vault global contract"
  # -------------------------------------------------------------------------------------------
  if [ "$PUBLISHED" = 1 ]; then echo "  already published — skipping"; else
    near contract deploy-as-global use-file "$RES/oiko_vault.wasm" as-global-hash "$ROOT" $NET $SIGN
  fi

  # -------------------------------------------------------------------------------------------
  step "3/7 Ajo on $AJO (mainnet build)"
  # -------------------------------------------------------------------------------------------
  if [ "$(rpc exists "$AJO")" = 1 ]; then echo "  $AJO exists"; else
    near account create-account fund-myself "$AJO" "$AJO_FUNDING_NEAR NEAR" autogenerate-new-keypair \
      save-to-legacy-keychain sign-as "$ROOT" $NET $SIGN >/dev/null
    echo "  created $AJO"
  fi
  if [ "$(rpc code_hash "$AJO")" = "$AJO_HASH" ]; then echo "  ajo already deployed ($AJO_HASH)"; else
    [ "$(rpc code_hash "$AJO")" = "11111111111111111111111111111111" ] || die "$AJO runs other code; refusing to overwrite on mainnet"
    near contract deploy "$AJO" use-file "$RES/oiko_ajo_mainnet.wasm" with-init-call new \
      json-args "{\"usdc\":\"$USDC\",\"usdt\":\"$USDT\"}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN >/dev/null
    echo "  deployed oiko_ajo_mainnet.wasm"
  fi

  # -------------------------------------------------------------------------------------------
  step "4/7 Register $AJO on USDC and USDt"
  # -------------------------------------------------------------------------------------------
  for t in "$USDC" "$USDT"; do
    if [ "$(rpc view "$t" storage_balance_of "{\"account_id\":\"$AJO\"}")" = "null" ]; then
      near contract call-function as-transaction "$t" storage_deposit json-args "{\"account_id\":\"$AJO\",\"registration_only\":true}" \
        prepaid-gas '30.0 Tgas' attached-deposit '0.0125 NEAR' sign-as "$AJO" $NET $SIGN >/dev/null
      echo "  registered on $t (excess refunded)"
    else echo "  already registered on $t"; fi
  done

  # -------------------------------------------------------------------------------------------
  step "5/7 Registry on $ROOT"
  # -------------------------------------------------------------------------------------------
  if [ "$(rpc code_hash "$ROOT")" = "$REG_HASH" ]; then echo "  registry already deployed"; else
    [ "$(rpc code_hash "$ROOT")" = "11111111111111111111111111111111" ] || die "$ROOT runs other code; refusing to overwrite on mainnet"
    near contract deploy "$ROOT" use-file "$RES/oiko_registry.wasm" with-init-call new json-args \
      "{\"vault_code_hash\":\"$HASH\",\"usdc\":\"$USDC\",\"usdt\":\"$USDT\",\"lending\":\"$LENDING\",\"ajo\":\"$AJO\",\"mpc_signer\":\"$MPC\",\"relayer\":\"$RELAYER\",\"account_funding\":\"$ACCOUNT_FUNDING\"}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN >/dev/null
    echo "  deployed oiko_registry.wasm"
  fi

  # -------------------------------------------------------------------------------------------
  step "6/7 Verify"
  # -------------------------------------------------------------------------------------------
  rpc view "$ROOT" config '{}' | grep -q "\"vault_code_hash\":\"$HASH\"" || die "registry vault_code_hash mismatch"
  echo "  registry config().vault_code_hash == $HASH"
  [ "$(rpc view "$AJO" next_circle_id '{}')" = 1 ] && echo "  ajo next_circle_id == 1"
  [ "$(rpc global_exists "$HASH")" = 1 ] && echo "  vault global contract is published"
  echo "  When the app works end to end, run: ROOT=$ROOT bash scripts/deploy-mainnet.sh --lock"
fi

# ---------------------------------------------------------------------------------------------
step "7/7 Lock"
# ---------------------------------------------------------------------------------------------
if [ "$LOCK" = 1 ]; then
  cat <<EOF

  ###########################################################################################
  #  WARNING (MAINNET): this deletes EVERY full-access key on $ROOT and $AJO.
  #  After this NOBODY can change, upgrade or redeploy the registry or ajo, or move the NEAR
  #  they hold. This cannot be undone.
  ###########################################################################################
EOF
  read -r -p "  Type LOCK $ROOT to continue: " answer
  [ "$answer" = "LOCK $ROOT" ] || die "not confirmed"
  for acc in "$ROOT" "$AJO"; do
    keys=$(rpc full_keys "$acc" | paste -sd, -)
    if [ -z "$keys" ]; then echo "  $acc is already keyless"; continue; fi
    near account delete-keys "$acc" public-keys "$keys" $NET $SIGN >/dev/null
    [ -z "$(rpc full_keys "$acc")" ] && echo "  $acc is now keyless"
  done
else
  echo "  skipped (pass --lock later)"
fi

cat <<EOF

Set these env vars (Vercel + .env) for mainnet:
OIKO_NETWORK=mainnet
OIKO_ROOT_ACCOUNT=$ROOT
OIKO_USDC=$USDC
OIKO_USDT=$USDT
OIKO_LENDING=$LENDING
OIKO_AJO=$AJO
OIKO_MPC_SIGNER=$MPC
OIKO_VAULT_CODE_HASH=$HASH
RELAYER_ACCOUNT_ID=$RELAYER
EOF
