// Signed webhooks for agent events. An agent registers an https URL (POST /api/agent/webhook, NEP-413 or bearer
// session); Oiko's cron delivers new events there, signed with HMAC-SHA256 over "<timestamp>.<body>" using a secret
// returned once at registration. Undelivered events are retried on the next cron run; after 20 straight failures the
// webhook is switched off. Before every delivery the agent's key and policy are re-checked on chain.
import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "./errors";
import type { OikoEvent } from "./events";
import type { Store } from "./store";

export interface Webhook {
  vaultId: string;
  publicKey: string;
  url: string;
  secret: string;
  createdAt: string;
  /** Ids of events already delivered (most recent 500). */
  delivered: string[];
  failures: number;
  lastError: string | null;
  lastDeliveryAt: string | null;
  disabled: boolean;
}
export const webhookKey = (vaultId: string, publicKey: string) => `webhook:${vaultId}:${publicKey}`;
export const WEBHOOK_PREFIX = "webhook:";
const MAX_FAILURES = 20;
/** Only events this recent are delivered (older ones are still readable via GET /api/agent/events). */
export const DELIVERY_WINDOW_MS = 7 * 86_400_000;

function privateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}

/** https only, no private or loopback hosts (local mode allows http://localhost for testing). */
export function checkWebhookUrl(raw: string, allowLocal: boolean): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError("E_BAD_REQUEST", 400, "url must be a full https:// URL.");
  }
  if (u.username || u.password) throw new ApiError("E_BAD_REQUEST", 400, "url must not contain a username or password.");
  const local = privateHost(u.hostname);
  if (allowLocal && local && (u.protocol === "http:" || u.protocol === "https:")) return u.toString();
  if (u.protocol !== "https:") throw new ApiError("E_BAD_REQUEST", 400, "url must use https.");
  if (local) throw new ApiError("E_BAD_REQUEST", 400, "url must be a public address.");
  return u.toString();
}

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function registerWebhook(s: Store, vaultId: string, publicKey: string, url: string, now: number) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const w: Webhook = { vaultId, publicKey, url, secret, createdAt: new Date(now).toISOString(), delivered: [], failures: 0, lastError: null, lastDeliveryAt: null, disabled: false };
  await s.setSetting(webhookKey(vaultId, publicKey), w);
  return {
    url, secret, note: "Keep the secret: it is shown only once. Each delivery is a POST with JSON { events, delivered_at } and headers X-Oiko-Timestamp (unix ms) and X-Oiko-Signature: sha256=HMAC_SHA256(secret, \"<timestamp>.<body>\") in hex. Reply 2xx within 5 s.",
  };
}

export async function webhookStatus(s: Store, vaultId: string, publicKey: string) {
  const w = await s.getSetting<Webhook>(webhookKey(vaultId, publicKey));
  return w ? { url: w.url, disabled: w.disabled, failures: w.failures, last_error: w.lastError, last_delivery_at: w.lastDeliveryAt, created_at: w.createdAt } : null;
}

export type Poster = (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status: number }>;
/** Delivery-time guard: refuse hosts whose DNS answers include a private or loopback address. */
async function resolvesPublic(url: string): Promise<boolean> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !privateHost(host);
  const addrs = await lookup(host, { all: true }).catch(() => []);
  return addrs.length > 0 && addrs.every((a) => !privateHost(a.address));
}

export const fetchPoster: Poster = async (url, body, headers) => {
  const { serverConfig } = await import("./config");
  if (serverConfig().network !== "local" && !(await resolvesPublic(url))) throw new Error("the URL resolves to a private address");
  const r = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", "user-agent": "oiko-webhooks/1", ...headers }, redirect: "manual", signal: AbortSignal.timeout(5000) });
  return { ok: r.status >= 200 && r.status < 300, status: r.status };
};

/** Delivers events not yet delivered (newest window only). Returns how many were sent; updates the stored webhook. */
export async function deliver(s: Store, w: Webhook, events: OikoEvent[], now: number, post: Poster = fetchPoster): Promise<number> {
  if (w.disabled) return 0;
  const done = new Set(w.delivered);
  const fresh = events.filter((e) => !done.has(e.id) && Date.parse(e.at) > now - DELIVERY_WINDOW_MS);
  if (!fresh.length) return 0;
  const body = JSON.stringify({ events: fresh, delivered_at: new Date(now).toISOString() });
  let ok = false, err: string | null = null;
  try {
    const r = await post(w.url, body, { "x-oiko-timestamp": String(now), "x-oiko-signature": signWebhook(w.secret, now, body) });
    ok = r.ok;
    if (!ok) err = `HTTP ${r.status}`;
  } catch (e) {
    err = (e as Error).message.slice(0, 200);
  }
  const next: Webhook = ok
    ? { ...w, delivered: [...w.delivered, ...fresh.map((e) => e.id)].slice(-500), failures: 0, lastError: null, lastDeliveryAt: new Date(now).toISOString() }
    : { ...w, failures: w.failures + 1, lastError: err, disabled: w.failures + 1 >= MAX_FAILURES };
  await s.setSetting(webhookKey(w.vaultId, w.publicKey), next);
  return ok ? fresh.length : 0;
}
