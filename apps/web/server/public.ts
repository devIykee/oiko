import { accountIdFor, NAME_RE, RegistryClient, vaultIdFor } from "@oiko/sdk";
import { explorerBase, serverConfig } from "./config";
import { ApiError } from "./errors";
import { rpc } from "./near";
import { authenticateOwner } from "./gateway";
import { store } from "./store";

export function publicConfig() {
  const cfg = serverConfig();
  const c = cfg.oiko.contracts;
  return {
    network: cfg.network, root: cfg.oiko.root,
    contracts: { registry: c.registry, usdc: c.usdc, usdt: c.usdt, lending: c.lending, ajo: c.ajo, mpcSigner: c.mpcSigner },
    vaultCodeHash: cfg.vaultCodeHash, explorer: explorerBase(cfg.network), features: cfg.features,
    nodeUrl: cfg.oiko.nodeUrl, relayer: cfg.relayer?.accountId ?? null, oneClick: cfg.oneclick.isMock ? "mock" : "1click",
    vapidPublicKey: cfg.vapid?.publicKey ?? null,
  };
}

export async function nameInfo(raw: string) {
  const cfg = serverConfig();
  const name = decodeURIComponent(raw).toLowerCase();
  const accountId = accountIdFor(name, cfg.oiko), vaultId = vaultIdFor(name, cfg.oiko);
  if (!NAME_RE.test(name)) {
    return { name, available: false, accountId, vaultId, exists: false, suggestions: [], error: { code: "E_NAME_INVALID", message: "Use 2 to 32 lowercase letters, numbers, - or _." } };
  }
  const reg = new RegistryClient(rpc(), cfg.oiko.contracts.registry);
  const [available, exists] = await Promise.all([reg.isAvailable(name), rpc().accountExists(accountId)]);
  const suggestions = available ? [] : await reg.suggest(name).catch(() => []);
  return { name, available, accountId, vaultId, exists, suggestions };
}

export async function pushSubscribe(req: Request, body: string, sub: { accountId: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }) {
  const url = new URL(req.url);
  const owner = await authenticateOwner({ method: "POST", path: url.pathname + url.search, body, authorization: req.headers.get("authorization") });
  if (owner.accountId !== sub.accountId) throw new ApiError("E_UNAUTHORIZED", 403);
  await store().savePush({ accountId: sub.accountId, endpoint: sub.subscription.endpoint, p256dh: sub.subscription.keys.p256dh, auth: sub.subscription.keys.auth });
  return { ok: true };
}
