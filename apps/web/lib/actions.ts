"use client";
// Money actions signed in the browser with the app key (function-call key on the name account, receiver = vault).
// NEAR fees come from the key's allowance, which the relayer tops up (POST /api/topup).
import { Signer, VaultClient, friendlyError, type TxResult } from "@oiko/sdk";
import { useCallback } from "react";
import { api } from "./api";
import { useConfig } from "./config";
import { fixtureAction, isFixtureMode } from "./fixtures/mode";
import { invalidate } from "./query";
import { useSession } from "./session";

type Methods = {
  [K in keyof VaultClient]: VaultClient[K] extends (...a: infer A) => Promise<TxResult> ? A : never;
};
export type VaultMethod = { [K in keyof Methods]: Methods[K] extends never ? never : K }[keyof Methods];

import { ActionError } from "./explain";
export { ActionError, explain } from "./explain";

let lastTopup = 0;
async function topup(accountId: string) {
  if (Date.now() - lastTopup < 10 * 60_000) return;
  lastTopup = Date.now();
  await api("/api/topup", { body: { accountId } }).catch(() => undefined);
}

export function useMoney() {
  const { session, getOwnerKey } = useSession();
  const { rpc } = useConfig();

  const run = useCallback(async (signerKey: string, method: VaultMethod, args: unknown[]): Promise<TxResult> => {
    if (!session) throw new ActionError("E_NO_KEY", "You're signed out.", "Sign in again.");
    let res: TxResult;
    if (isFixtureMode()) {
      try { res = await fixtureAction(method, args); } catch (e) { const f = friendlyError((e as Error).message); throw new ActionError(f.code, f.title, f.next); }
    } else {
      if (!rpc) throw new ActionError("E_RPC", "Oiko is still loading.", "Try again in a moment.");
      await topup(session.accountId);
      const client = new VaultClient(rpc, session.vaultId, new Signer(rpc, session.accountId, signerKey));
      const fn = (client as unknown as Record<string, unknown>)[method] as ((...a: unknown[]) => Promise<TxResult>) | undefined;
      if (typeof fn !== "function") throw new ActionError("E_DISABLED", "This isn't available yet.", "It needs a newer version of Oiko.");
      try {
        res = await fn.apply(client, args);
      } catch (e) {
        const f = friendlyError((e as Error).message);
        throw new ActionError(f.code, f.title, f.next);
      }
      if (!res.ok && res.errorCode === "E_NO_GAS") {
        lastTopup = 0;
        await topup(session.accountId);
        // NotEnoughAllowance is usually the previous call's gas reservation, which is refunded to the key a few blocks later.
        if (/NotEnoughAllowance/.test(res.errorMessage ?? "")) await new Promise((r) => setTimeout(r, 4000));
        res = await fn.apply(client, args);
      }
    }
    if (!res.ok) {
      const f = friendlyError(res.errorCode ?? res.errorMessage ?? "");
      throw new ActionError(f.code, f.title, f.next, res.txHash);
    }
    invalidate(`vault:${session.vaultId}`);
    invalidate("ajo:");
    return res;
  }, [session, rpc]);

  /** Day-to-day action with the app key. */
  const exec = useCallback(<K extends VaultMethod>(method: K, ...args: Methods[K]) => run(session?.appKey ?? "", method, args), [run, session]);
  /** Full-access action (e.g. withdraw_large): asks for the passkey when needed. */
  const execOwner = useCallback(async <K extends VaultMethod>(method: K, ...args: Methods[K]) => {
    const key = isFixtureMode() ? "" : await getOwnerKey();
    return run(key, method, args);
  }, [run, getOwnerKey]);

  /** For vault methods the SDK may not have yet (e.g. ajo circle creation); fails with E_DISABLED when missing. */
  const execOptional = useCallback((method: string, ...args: unknown[]) => run(session?.appKey ?? "", method as VaultMethod, args), [run, session]);

  return { exec, execOwner, execOptional };
}
