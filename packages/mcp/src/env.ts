import { decodeConnectionString, decodeViewKey, publicKeyFromSecretKey, type AgentConnection } from "@oiko/sdk";

/** OIKO_CONNECTION=oiko1:… or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL. Optional OIKO_VIEW_KEY=oikoview1:… (private labels). */
export function connectionFromEnv(env: Record<string, string | undefined> = process.env): AgentConnection {
  const vk = env.OIKO_VIEW_KEY?.trim() || undefined;
  if (vk) decodeViewKey(vk);
  if (env.OIKO_CONNECTION) {
    const c = decodeConnectionString(env.OIKO_CONNECTION);
    return vk ? { ...c, vk } : c;
  }
  const sk = env.OIKO_AGENT_KEY, vault = env.OIKO_VAULT_ID, api = env.OIKO_API_URL || "https://oikodotnear.vercel.app";
  if (!sk || !vault || !api) {
    throw new Error("Set OIKO_CONNECTION (the oiko1:… string from Oiko → Agents), or OIKO_AGENT_KEY and OIKO_VAULT_ID (OIKO_API_URL defaults to https://oikodotnear.vercel.app).");
  }
  publicKeyFromSecretKey(sk);
  return { api: api.replace(/\/+$/, ""), vault, sk, ...(vk ? { vk } : {}) };
}
