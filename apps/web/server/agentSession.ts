// Hosted agent sessions: a no-install path for remote MCP clients (Grok, ChatGPT, Claude.ai connectors) that can't sign
// every request. The agent signs ONE NEP-413 request with its own key (POST /api/agent/session) and gets a short-lived
// bearer token scoped to that vault + key (<= 24 h). The server never sees or keeps the agent's key.
// Every request made with the token re-runs the on-chain check (view_access_key + agent policy), so Disconnect, which
// deletes the key from the vault, ends the session immediately. A session can also be revoked on its own.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors";
import { authenticateAgent, authorizeAgentKey, defaultDeps as defaultGatewayDeps, type AuthedAgent, type GatewayDeps, type GatewayRequest } from "./gateway";

export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
export const SESSION_DEFAULT_MS = 12 * 60 * 60 * 1000;
const PREFIX = "oikos1";

export interface SessionClaims { v: 1; sid: string; vault: string; pk: string; exp: number }
export interface SessionEnv { AGENT_SESSION_SECRET?: string; RELAYER_PRIVATE_KEY?: string; CRON_SECRET?: string }

function secret(env: SessionEnv = process.env as SessionEnv): Buffer {
  const base = env.AGENT_SESSION_SECRET || env.RELAYER_PRIVATE_KEY || env.CRON_SECRET;
  if (!base) throw new ApiError("E_DISABLED", 503, "Hosted agent sessions aren't set up on this deployment.");
  return createHmac("sha256", "oiko-agent-session-v1").update(base).digest();
}
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSessionToken(c: SessionClaims, env?: SessionEnv): string {
  const body = b64u(JSON.stringify(c));
  return `${PREFIX}.${body}.${b64u(createHmac("sha256", secret(env)).update(body).digest())}`;
}

/** Signature + expiry only (the on-chain check happens in authenticateBearer). Null for anything invalid. */
export function verifySessionToken(token: string, now = Date.now(), env?: SessionEnv): SessionClaims | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, body, sig] = parts as [string, string, string];
  const want = createHmac("sha256", secret(env)).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (c.v !== 1 || typeof c.exp !== "number" || c.exp <= now || c.exp - now > SESSION_MAX_MS + 60_000) return null;
    if (typeof c.vault !== "string" || typeof c.pk !== "string" || typeof c.sid !== "string") return null;
    return c;
  } catch {
    return null;
  }
}

const revokedKey = (sid: string) => `agent-session-revoked:${createHash("sha256").update(sid).digest("hex").slice(0, 32)}`;

/** POST /api/agent/session: the agent proves its key once (NEP-413 over this request) and gets a bearer token. */
export async function createSession(req: GatewayRequest, ttlMs: number | undefined, deps: GatewayDeps = defaultGatewayDeps(), env?: SessionEnv) {
  const agent = await authenticateAgent(req, "read", deps);
  const now = deps.now();
  const ttl = Math.max(5 * 60_000, Math.min(SESSION_MAX_MS, ttlMs ?? SESSION_DEFAULT_MS));
  // Never outlive the agent's own expiry.
  const exp = Math.min(now + ttl, Number(BigInt(agent.policy.expires_at) / 1_000_000n));
  const claims: SessionClaims = { v: 1, sid: b64u(randomBytes(16)), vault: agent.vaultId, pk: agent.publicKey, exp };
  return { token: signSessionToken(claims, env), expires_at: new Date(exp).toISOString(), vault: agent.vaultId, public_key: agent.publicKey, scopes: agent.policy.scopes };
}

/** Bearer auth for /api/mcp and the read tools: valid token, not revoked, and the key + policy still live on chain. */
export async function authenticateBearer(authorization: string | null, scope: "read" | null, deps: GatewayDeps = defaultGatewayDeps(), env?: SessionEnv): Promise<AuthedAgent & { sessionId: string }> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!m) throw new ApiError("E_AUTH", 401, "Send Authorization: Bearer <session token>.");
  return authenticateToken(m[1]!, scope, deps, env);
}

export async function authenticateToken(token: string, scope: "read" | null, deps: GatewayDeps = defaultGatewayDeps(), env?: SessionEnv): Promise<AuthedAgent & { sessionId: string }> {
  const c = verifySessionToken(token, deps.now(), env);
  if (!c) throw new ApiError("E_AUTH", 401, "This session token is invalid or has expired. Ask the owner for a new one.");
  if (await deps.store.getSetting<boolean>(revokedKey(c.sid))) throw new ApiError("E_AUTH", 401, "This session was ended. Ask the owner for a new one.");
  const agent = await authorizeAgentKey(c.vault, c.pk, scope, deps);
  return { ...agent, sessionId: c.sid };
}

/** DELETE /api/agent/session with the bearer token: ends this session now (the agent's key keeps working). */
export async function revokeSession(authorization: string | null, deps: GatewayDeps = defaultGatewayDeps(), env?: SessionEnv) {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  const c = m ? verifySessionToken(m[1]!, deps.now(), env) : null;
  if (!c) throw new ApiError("E_AUTH", 401);
  await deps.store.setSetting(revokedKey(c.sid), true);
  return { ok: true };
}
