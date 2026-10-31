// Optional Web Push (VAPID). Skips quietly when VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set.
import { serverConfig } from "./config";
import { store } from "./store";

export function pushEnabled(): boolean {
  return serverConfig().vapid !== null;
}

export async function sendPush(accountId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  const vapid = serverConfig().vapid;
  if (!vapid) return 0;
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const subs = await store().listPush(accountId);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await store().deletePush(s.endpoint);
    }
  }
  return sent;
}
