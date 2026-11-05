#!/usr/bin/env python3
"""Read-only NEAR RPC helper for the deploy scripts: python3 scripts/near-rpc.py <rpc-url> <cmd> <args...>"""
import base64, hashlib, json, sys, urllib.request
RPC = sys.argv[1]; cmd = sys.argv[2]; a = sys.argv[3:]
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(d):
    n = int.from_bytes(d, 'big'); s = ''
    while n: n, r = divmod(n, 58); s = A[r] + s
    return '1' * (len(d) - len(d.lstrip(b'\0'))) + s
def q(params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": dict(finality="final", **params)}).encode()
    req = urllib.request.Request(RPC, body, {"content-type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    if "error" in r: raise RuntimeError(json.dumps(r["error"]))
    res = r["result"]
    if isinstance(res, dict) and res.get("error"): raise RuntimeError(res["error"])
    return res
def account(acc):
    try: return q({"request_type": "view_account", "account_id": acc})
    except RuntimeError: return None
def keys_with_prefix(acc, prefix):
    try:
        return [v["key"] for v in q({"request_type": "view_state", "account_id": acc,
                                       "prefix_base64": base64.b64encode(prefix).decode()})["values"]]
    except RuntimeError as e:
        if "too large" not in str(e).lower() or len(prefix) > 64: raise
        out = []
        for b in range(256):  # split the key space by the next byte
            out += keys_with_prefix(acc, prefix + bytes([b]))
        return out
if cmd == "hash":            # file -> base58 sha256
    print(b58(hashlib.sha256(open(a[0], 'rb').read()).digest()))
elif cmd == "size":
    import os; print(os.path.getsize(a[0]))
elif cmd == "balance":       # account -> yocto amount (0 if missing)
    r = account(a[0]); print(int(r["amount"]) if r else 0)
elif cmd == "storage":       # account -> storage bytes
    r = account(a[0]); print(r["storage_usage"] if r else 0)
elif cmd == "exists":
    print(1 if account(a[0]) else 0)
elif cmd == "code_hash":
    r = account(a[0]); print(r["code_hash"] if r else "")
elif cmd == "global_exists":  # code hash -> 1 if published as a global contract
    try: q({"request_type": "view_global_contract_code", "code_hash": a[0]}); print(1)
    except Exception: print(0)
elif cmd == "keys":          # account -> JSON array of base64 storage keys
    print(json.dumps(keys_with_prefix(a[0], b"")))
elif cmd == "batches":       # account size -> one JSON args object per line
    ks = keys_with_prefix(a[0], b""); n = int(a[1])
    for i in range(0, len(ks), n): print(json.dumps({"keys": ks[i:i + n]}))
elif cmd == "view":          # account method json -> raw result text
    r = q({"request_type": "call_function", "account_id": a[0], "method_name": a[1],
           "args_base64": base64.b64encode(a[2].encode()).decode()})
    print(bytes(r["result"]).decode())
elif cmd == "full_keys":     # account -> full-access public keys, one per line
    r = q({"request_type": "view_access_key_list", "account_id": a[0]})
    for k in r["keys"]:
        if k["access_key"]["permission"] == "FullAccess": print(k["public_key"])
elif cmd == "near":          # yocto -> NEAR string
    print(f"{int(a[0]) / 1e24:.4f}")
elif cmd == "yocto":         # NEAR (decimal string) -> yocto
    from decimal import Decimal; print(int(Decimal(a[0]) * 10**24))
