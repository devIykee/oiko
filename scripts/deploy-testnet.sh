#!/usr/bin/env bash
# Deploys Oiko contracts to NEAR testnet under ROOT (default oiko.testnet).
# Prereqs: near-cli-rs, keys for ROOT and RELAYER in ~/.near-credentials (legacy keychain), built wasm in contracts/res.
# Usage: bash scripts/deploy-testnet.sh            (idempotent-ish: skips accounts that already exist)
set -euo pipefail
ROOT=${ROOT:-oiko.testnet}
RELAYER=${RELAYER:-oiko-relayer.testnet}
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
RES="$(cd "$(dirname "$0")/.." && pwd)/contracts/res"
ACCOUNT_FUNDING=${ACCOUNT_FUNDING:-600000000000000000000000}   # 0.6 NEAR per signup on testnet
MPC=${MPC:-v1.signer-prod.testnet}

exists() { near account view-account-summary "$1" $NET now >/dev/null 2>&1; }
sub() { # sub <name> <near-amount>
  local id="$1.$ROOT"
  if exists "$id"; then echo "exists: $id"; else
    near account create-account fund-myself "$id" "$2 NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as "$ROOT" $NET $SIGN >/dev/null
    echo "created: $id"
  fi
}
deploy() { # deploy <account> <wasm> <method> <json>
  near contract deploy "$1" use-file "$RES/$2" with-init-call "$3" json-args "$4" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN >/dev/null
  echo "deployed $2 -> $1"
}

USDC="usdc.$ROOT"; USDT="usdt.$ROOT"; LENDING="lending.$ROOT"; AJO="ajo.$ROOT"

sub usdc 2.2; sub usdt 2.2; sub lending 2.6; sub ajo 2.9

deploy "$USDC" oiko_mock_ft.wasm new "{\"name\":\"USD Coin (Oiko testnet)\",\"symbol\":\"USDC\",\"minter\":\"$RELAYER\"}"
deploy "$USDT" oiko_mock_ft.wasm new "{\"name\":\"Tether USD (Oiko testnet)\",\"symbol\":\"USDT\",\"minter\":\"$RELAYER\"}"
deploy "$LENDING" oiko_mock_lending.wasm new "{\"admin\":\"$RELAYER\",\"tokens\":[\"$USDC\",\"$USDT\"],\"extra_decimals\":12}"
deploy "$AJO" oiko_ajo.wasm new "{\"usdc\":\"$USDC\",\"usdt\":\"$USDT\"}"

# Publish the vault code once as a global contract identified by its code hash.
HASH=$(python3 - "$RES/oiko_vault.wasm" <<'PY'
import hashlib,sys
d=hashlib.sha256(open(sys.argv[1],'rb').read()).digest()
A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n=int.from_bytes(d,'big');s=''
while n: n,r=divmod(n,58); s=A[r]+s
print(s)
PY
)
echo "vault code hash: $HASH"
if [ "${SKIP_GLOBAL:-0}" != "1" ]; then
  near contract deploy-as-global use-file "$RES/oiko_vault.wasm" as-global-hash "$ROOT" $NET $SIGN
fi

deploy "$ROOT" oiko_registry.wasm new "{\"vault_code_hash\":\"$HASH\",\"usdc\":\"$USDC\",\"usdt\":\"$USDT\",\"lending\":\"$LENDING\",\"ajo\":\"$AJO\",\"mpc_signer\":\"$MPC\",\"relayer\":\"$RELAYER\",\"account_funding\":\"$ACCOUNT_FUNDING\"}"

cat <<EOF

Set these env vars (Vercel + .env):
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
