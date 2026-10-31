import { b64decode, b64encode, fromUtf8, utf8 } from "./encoding";

export class RpcError extends Error {
  constructor(message: string, public readonly cause_?: unknown, public readonly name_?: string) {
    super(message);
    this.name = "RpcError";
  }
}

/** Minimal isomorphic NEAR JSON-RPC client (fetch only). */
export class NearRpc {
  private id = 0;
  constructor(public readonly nodeUrl: string, private readonly fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {}

  async request<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.nodeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    if (!res.ok && res.status !== 200) {
      const text = await res.text().catch(() => "");
      throw new RpcError(`RPC HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const j = (await res.json()) as { result?: T & { error?: string }; error?: { name?: string; message?: string; data?: unknown; cause?: { name?: string; info?: unknown } } };
    if (j.error) {
      const causeName = j.error.cause?.name;
      const data = typeof j.error.data === "string" ? j.error.data : JSON.stringify(j.error.data ?? j.error.cause ?? "");
      throw new RpcError(`${causeName ?? j.error.name ?? "RPC_ERROR"}: ${data || j.error.message}`, j.error, causeName);
    }
    if (j.result && typeof (j.result as { error?: unknown }).error === "string") {
      throw new RpcError((j.result as { error: string }).error, j.result);
    }
    return j.result as T;
  }

  async view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
    const r = await this.request<{ result: number[]; logs: string[] }>("query", {
      request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: method,
      args_base64: b64encode(utf8(JSON.stringify(args))),
    });
    const text = fromUtf8(Uint8Array.from(r.result));
    return (text === "" ? null : JSON.parse(text)) as T;
  }

  async viewAccessKey(accountId: string, publicKey: string): Promise<{ nonce: number; permission: unknown } | null> {
    try {
      const r = await this.request<{ nonce: number; permission: unknown }>("query", {
        request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey,
      });
      return { nonce: r.nonce, permission: r.permission };
    } catch (e) {
      const msg = String((e as Error).message);
      if (/UNKNOWN_ACCESS_KEY|does not exist|UNKNOWN_ACCOUNT/i.test(msg)) return null;
      throw e;
    }
  }

  async viewAccessKeyList(accountId: string): Promise<Array<{ public_key: string; access_key: { nonce: number; permission: unknown } }>> {
    const r = await this.request<{ keys: Array<{ public_key: string; access_key: { nonce: number; permission: unknown } }> }>("query", {
      request_type: "view_access_key_list", finality: "optimistic", account_id: accountId,
    });
    return r.keys;
  }

  async viewAccount(accountId: string): Promise<{ amount: string; locked: string; code_hash: string; storage_usage: number; global_contract_hash?: string | null } | null> {
    try {
      return await this.request("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
    } catch (e) {
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(String((e as Error).message))) return null;
      throw e;
    }
  }

  async accountExists(accountId: string): Promise<boolean> {
    return (await this.viewAccount(accountId)) !== null;
  }

  async block(finality: "final" | "optimistic" = "final"): Promise<{ hash: string; height: number }> {
    const r = await this.request<{ header: { hash: string; height: number } }>("block", { finality });
    return { hash: r.header.hash, height: r.header.height };
  }

  async sendTx(signedTxBase64: string, waitUntil: "NONE" | "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL" = "EXECUTED_OPTIMISTIC"): Promise<FinalOutcome> {
    return this.request<FinalOutcome>("send_tx", { signed_tx_base64: signedTxBase64, wait_until: waitUntil });
  }

  async txStatus(txHash: string, senderId: string): Promise<FinalOutcome> {
    return this.request<FinalOutcome>("tx", { tx_hash: txHash, sender_account_id: senderId, wait_until: "EXECUTED_OPTIMISTIC" });
  }
}

export interface ExecutionOutcomeView {
  id: string;
  outcome: { logs: string[]; status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown } | string; executor_id?: string };
}
export interface FinalOutcome {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  transaction?: { hash: string; signer_id: string };
  transaction_outcome?: ExecutionOutcomeView;
  receipts_outcome?: ExecutionOutcomeView[];
  final_execution_status?: string;
}

export interface TxResult { txHash: string; ok: boolean; value?: unknown; errorCode?: string; errorMessage?: string; logs: string[] }

const CODE_RE = /\b(E_[A-Z0-9_]+)\b/;

function failureMessage(f: unknown): string {
  if (!f) return "Transaction failed";
  const s = JSON.stringify(f);
  const panic = /"(?:ExecutionError|FunctionCallError)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (panic) return JSON.parse(`"${panic[1]}"`) as string;
  const pm = /Smart contract panicked: ((?:[^"\\]|\\.)*)/.exec(s);
  if (pm) return pm[1]!;
  return s.slice(0, 400);
}

/** Turns an RPC final outcome into a flat result. Any failing receipt makes the result not ok. */
export function parseOutcome(o: FinalOutcome, fallbackHash = ""): TxResult {
  const txHash = o.transaction?.hash ?? o.transaction_outcome?.id ?? fallbackHash;
  const logs: string[] = [...(o.transaction_outcome?.outcome.logs ?? [])];
  let firstFailure: unknown = null;
  for (const r of o.receipts_outcome ?? []) {
    logs.push(...r.outcome.logs);
    const st = r.outcome.status;
    if (st && typeof st === "object" && "Failure" in st && !firstFailure) firstFailure = st.Failure;
  }
  const status = o.status;
  if (status && typeof status === "object" && "Failure" in status) firstFailure = status.Failure ?? firstFailure;
  if (firstFailure) {
    const errorMessage = failureMessage(firstFailure);
    return { txHash, ok: false, errorMessage, errorCode: CODE_RE.exec(errorMessage)?.[1] ?? "E_TX_FAILED", logs };
  }
  let value: unknown;
  if (status && typeof status === "object" && typeof status.SuccessValue === "string" && status.SuccessValue !== "") {
    const text = fromUtf8(b64decode(status.SuccessValue));
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { txHash, ok: true, value, logs };
}

/** Parses NEP-297 "EVENT_JSON:" log lines. */
export function parseEvents(logs: string[]): Array<{ standard: string; version: string; event: string; data: unknown[] }> {
  const out = [];
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    try {
      out.push(JSON.parse(l.slice(11)));
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}
