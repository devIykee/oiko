#!/usr/bin/env bash
# Backwards-compatibility check for private labels (Veil, docs/PRIVACY.md): runs the sandbox test
# contracts/tests/tests/veil.rs against the OLDER vault code that accounts created before 2026-11-05 still use
# (code hash 3G9Gwhrtq8gN1ugLLNBShdjbw3s1imNH8FVrUXYWTPPR, source at commit 67c925f), then restores the current build.
# Needs what `pnpm test:contracts` needs (Rust, cargo-near) and a built contracts/res/ (scripts/build-contracts.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD_REV="${OLD_REV:-67c925f}"
TMP="$(mktemp -d)"
trap 'cp "$TMP/current.wasm" "$ROOT/contracts/res/oiko_vault.wasm" 2>/dev/null || true; git -C "$ROOT" worktree remove --force "$TMP/src" 2>/dev/null || true; rm -rf "$TMP"' EXIT
cp "$ROOT/contracts/res/oiko_vault.wasm" "$TMP/current.wasm"
git -C "$ROOT" worktree add -q "$TMP/src" "$OLD_REV"
(cd "$TMP/src/contracts" && CARGO_TARGET_DIR="$ROOT/contracts/target-old" cargo near build non-reproducible-wasm --no-abi --manifest-path vault/Cargo.toml --out-dir "$TMP/old" >&2)
cp "$TMP/old/oiko_vault.wasm" "$ROOT/contracts/res/oiko_vault.wasm"
echo "veil-compat: running the Veil sandbox test against the vault from $OLD_REV" >&2
(cd "$ROOT/contracts" && OIKO_SKIP_BUILD=1 cargo test -p oiko-tests --test veil)
echo "veil-compat: ok (sealed labels work on the older vault too)"
