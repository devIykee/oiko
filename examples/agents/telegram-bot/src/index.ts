// Telegram bot skeleton (no LLM). Each chat command is relayed to an Oiko MCP tool through an in-process MCP client.
// Env: TELEGRAM_BOT_TOKEN, OIKO_CONNECTION (or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL),
//      TELEGRAM_ALLOWED_CHAT_IDS=123,456 (required: only these chats may use the bot; it holds an agent key).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectionFromEnv, createOikoMcpServer, GatewayBackend } from "@oiko/mcp";
import { toUnits } from "@oiko/sdk";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED = new Set((process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const API = `https://api.telegram.org/bot${TOKEN}`;

const HELP = `Oiko bot (no AI). Commands:
/overview · /pots · /goals · /plan · /bills · /activity [n] · /insights [yyyymm] · /rates · /rosca
/pay <amount> <usdc|usdt> <account.near> — pay now, inside your agent limits
/paybill <bill id> — pay a bill now
/save <amount> <usdc|usdt> <pot id> — move from Spend to a pot
/propose <amount> <usdc|usdt> <account.near> <reason…> — ask the owner to approve a payment`;

type Call = { name: string; arguments: Record<string, unknown> };

/** Pure: chat text -> MCP tool call (exported for tests and reuse). */
export function commandToTool(text: string): Call | { error: string } {
  const [cmd = "", ...args] = text.trim().split(/\s+/);
  const amount = (s?: string) => toUnits(s ?? "");
  const token = (s?: string) => {
    const t = (s ?? "").toLowerCase();
    if (t !== "usdc" && t !== "usdt") throw new Error("Token must be usdc or usdt.");
    return t;
  };
  try {
    switch (cmd.split("@")[0]) {
      case "/overview": return { name: "get_overview", arguments: {} };
      case "/pots": return { name: "get_pots", arguments: {} };
      case "/goals": return { name: "get_goals", arguments: {} };
      case "/plan": return { name: "get_splits", arguments: {} };
      case "/bills": return { name: "get_bills", arguments: {} };
      case "/rates": return { name: "get_earn_rates", arguments: {} };
      case "/rosca": return { name: "get_rosca_groups", arguments: {} };
      case "/activity": return { name: "get_activity", arguments: { limit: Math.min(100, Number(args[0] ?? 10) || 10) } };
      case "/insights": return { name: "get_insights", arguments: args[0] ? { month: args[0] } : {} };
      case "/pay": return { name: "act", arguments: { action: { type: "pay", amount: amount(args[0]), token: token(args[1]), to: args[2], memo: "Sent from Telegram" } } };
      case "/paybill": return { name: "act", arguments: { action: { type: "pay_bill", bill_id: Number(args[0]) } } };
      case "/save": return { name: "act", arguments: { action: { type: "save", amount: amount(args[0]), token: token(args[1]), to_pot: Number(args[2]) } } };
      case "/propose": return { name: "propose", arguments: { action: { type: "pay", amount: amount(args[0]), token: token(args[1]), to: args[2], memo: null }, reason: args.slice(3).join(" ") || "Requested from Telegram" } };
      default: return { error: HELP };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function tg(method: string, body: unknown) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }> };
}

async function main() {
  if (!TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN.");
  if (ALLOWED.size === 0) throw new Error("Set TELEGRAM_ALLOWED_CHAT_IDS: this bot can move money inside your agent limits.");
  const server = createOikoMcpServer(new GatewayBackend(connectionFromEnv()));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "oiko-telegram", version: "0.1.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  console.log("oiko telegram bot: polling");
  let offset = 0;
  for (;;) {
    const u = await tg("getUpdates", { offset, timeout: 30 }).catch(() => ({ ok: false, result: [] }));
    for (const up of u.result ?? []) {
      offset = up.update_id + 1;
      const chat = up.message?.chat.id;
      const text = up.message?.text;
      if (!chat || !text) continue;
      if (!ALLOWED.has(String(chat))) {
        await tg("sendMessage", { chat_id: chat, text: `This bot is private. Your chat id is ${chat}.` });
        continue;
      }
      const call = commandToTool(text);
      let reply: string;
      if ("error" in call) reply = call.error;
      else {
        const r = await mcp.callTool(call).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e) }] }));
        reply = ((r.content as Array<{ text?: string }>)[0]?.text ?? "").slice(0, 3900);
      }
      await tg("sendMessage", { chat_id: chat, text: reply });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`oiko telegram bot: ${(e as Error).message}`);
    process.exit(1);
  });
}
