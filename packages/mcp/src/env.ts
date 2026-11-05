import { decodeConnectionString, publicKeyFromSecretKey, type AgentConnection } from "@oiko/sdk";

/** OIKO_CONNECTION=oiko1:… or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL. */
export function connectionFromEnv(env: Record<string, string | undefined> = process.env): AgentConnection {
  if (env.OIKO_CONNECTION) return decodeConnectionString(env.OIKO_CONNECTION);
  const sk = env.OIKO_AGENT_KEY, vault = env.OIKO_VAULT_ID, api = env.OIKO_API_URL || "https://oikodotnear.vercel.app";
  if (!sk || !vault || !api) {
    throw new Error("Set OIKO_CONNECTION (the oiko1:… string from Oiko → Agents), or OIKO_AGENT_KEY and OIKO_VAULT_ID (OIKO_API_URL defaults to https://oikodotnear.vercel.app).");
  }
  publicKeyFromSecretKey(sk);
  return { api: api.replace(/\/+$/, ""), vault, sk };
}
