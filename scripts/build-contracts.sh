#!/usr/bin/env bash
# Builds every Oiko contract to contracts/res/*.wasm and prints sha256 (hex) and the NEAR code
# hash (base58 of sha256) for each. Builds run one at a time to keep memory use low.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
C="$ROOT/contracts"
RES="$C/res"
mkdir -p "$RES"
cd "$C"

build() { # <crate dir> <output name> [extra cargo-near args...]
  local dir="$1" out="$2"; shift 2
  local tmp; tmp="$(mktemp -d)"
  cargo near build non-reproducible-wasm --no-abi --manifest-path "$dir/Cargo.toml" --out-dir "$tmp" "$@" >&2
  mv "$tmp"/*.wasm "$RES/$out.wasm"
  rm -rf "$tmp"
}

build vault          oiko_vault
build registry       oiko_registry
build ajo            oiko_ajo                 # short-periods ON (60 s minimum): sandbox/testnet
build ajo            oiko_ajo_mainnet --no-default-features   # 1 day minimum period
build mocks/ft       oiko_mock_ft
build mocks/lending  oiko_mock_lending

b58() { python3 -c '
import sys,hashlib
a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
d=hashlib.sha256(open(sys.argv[1],"rb").read()).digest()
n=int.from_bytes(d,"big"); s=""
while n: n,r=divmod(n,58); s=a[r]+s
print("1"*(len(d)-len(d.lstrip(b"\0")))+s)' "$1"; }

printf "\n%-24s %9s  %-64s  %s\n" "wasm" "bytes" "sha256" "code hash (base58)"
for f in "$RES"/*.wasm; do
  printf "%-24s %9s  %-64s  %s\n" "$(basename "$f")" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)" "$(b58 "$f")"
done
