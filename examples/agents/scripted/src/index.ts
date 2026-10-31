// Oiko scripted agent: deterministic, no LLM. Shows the full agent story against a real Oiko account.
//   OIKO_CONNECTION=oiko1:… pnpm example:agent            (or OIKO_AGENT_KEY + OIKO_VAULT_ID + OIKO_API_URL)
//   pnpm example:agent -- --verify-revoke                 (after the payments, waits for you to Disconnect, then shows reads fail)
// Optional: OIKO_EXAMPLE_PAYEE=landlord.near (defaults to the first NEAR account on the agent's allowlist).
import { createInterface } from "node:readline/promises";
import { decodeConnectionString, formatAmount, friendlyError, GatewayClient, GatewayError, publicKeyFromSecretKey, type AgentAction, type AgentConnection, type Token } from "@oiko/sdk";

type Money = { units: string; token: string; display: string };
interface Me {
  vault: string; agent_name: string; scopes: string[]; allowed_actions: string[]; allowlist: Array<{ type: string; account_id?: string }>;
  caps: { per_tx: Money; day: { cap: Money; used: Money; remaining: Money }; week: { cap: Money; used: Money; remaining: Money } };
}
interface Overview {
  owner: string; totals: { total: Money }; spend_available: { usdc: Money; usdt: Money; total: Money };
  pots: Array<{ id: number; name: string; kind: string; kind_label: string; balances: { total: Money }; locked_until: string | null }>;
}

const say = (s = "") => console.log(s);
const step = (n: number, s: string) => say(`\n${n}. ${s}`);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

function connection(): AgentConnection {
  const env = process.env;
  if (env.OIKO_CONNECTION) return decodeConnectionString(env.OIKO_CONNECTION);
  if (env.OIKO_AGENT_KEY && env.OIKO_VAULT_ID && env.OIKO_API_URL) return { sk: env.OIKO_AGENT_KEY, vault: env.OIKO_VAULT_ID, api: env.OIKO_API_URL.replace(/\/+$/, "") };
  throw new Error("Set OIKO_CONNECTION (from Oiko → Agents → Connect), or OIKO_AGENT_KEY, OIKO_VAULT_ID and OIKO_API_URL.");
}

function explain(e: unknown): string {
  if (e instanceof GatewayError) return `${e.code}: ${e.message}`;
  const f = friendlyError((e as Error).message ?? String(e));
  return `${f.code}: ${f.title} ${f.next}`;
}

async function pay(c: GatewayClient, token: Token, amount: bigint, to: string, n: number) {
  const action: AgentAction = { type: "pay", token, amount: amount.toString(), to, memo: `Example agent payment ${n}` };
  const r = await c.run("act", action);
  if (r.ok) say(`   ✓ Paid ${formatAmount(amount.toString())} ${token.toUpperCase()} to ${to} (tx ${r.txHash})`);
  else say(`   ✗ Refused: ${r.error?.message ?? "unknown"} [${r.error?.code}]`);
  return r.ok;
}

async function main() {
  const conn = connection();
  const c = new GatewayClient(conn);
  const verifyRevoke = process.argv.includes("--verify-revoke");
  say(`Oiko example agent (no AI). Account ${conn.vault} via ${conn.api}`);
  say(`Agent key ${publicKeyFromSecretKey(conn.sk)}`);

  step(1, "Who am I and what may I do?");
  const me = await c.get<Me>("/api/agent/me");
  say(`   ${me.agent_name}: permissions ${me.scopes.join(", ")}; actions ${me.allowed_actions.join(", ") || "none"}`);
  say(`   Limits: ${me.caps.per_tx.display} per payment, ${me.caps.day.remaining.display} left today, ${me.caps.week.remaining.display} left this week`);

  step(2, "Read the overview");
  const ov = await c.get<Overview>("/api/agent/overview");
  say(`   Total ${ov.totals.total.display}; Spend available now ${ov.spend_available.total.display}`);
  for (const p of ov.pots) say(`   • ${p.name} (${p.kind_label}) ${p.balances.total.display}${p.locked_until ? `, locked until ${p.locked_until.slice(0, 10)}` : ""}`);

  const usdc = BigInt(ov.spend_available.usdc.units), usdt = BigInt(ov.spend_available.usdt.units);
  const token: Token = usdt >= usdc ? "usdt" : "usdc";
  const spend = token === "usdt" ? usdt : usdc;

  step(3, "Propose a move for the owner to approve");
  const target = ov.pots.find((p) => p.kind !== "flex" && !p.locked_until);
  if (!me.scopes.includes("propose")) say("   Skipped: this agent doesn't have the propose permission.");
  else if (!target || spend === 0n) say("   Skipped: nothing in Spend to move yet, or no other pot.");
  else {
    const amt = spend / 10n > 0n ? spend / 10n : 1n;
    const reason = `Spend has ${formatAmount(spend.toString())} ${token.toUpperCase()}. Moving ${formatAmount(amt.toString())} to ${target.name} keeps your plan on track.`;
    const r = await c.run("propose", { type: "save", to_pot: target.id, token, amount: amt.toString() }, reason);
    say(r.ok ? `   ✓ Proposed (id ${String(r.value)}): "${reason}" — approve or reject it in Oiko.` : `   ✗ ${r.error?.message} [${r.error?.code}]`);
  }

  step(4, "Pay an allowlisted recipient twice, then try a third payment over the limit");
  const payee = process.env.OIKO_EXAMPLE_PAYEE ?? me.allowlist.find((r) => r.type === "near")?.account_id;
  if (!me.scopes.includes("act") || !me.allowed_actions.includes("pay")) say("   Skipped: this agent may not pay (needs the act permission and the pay action).");
  else if (!payee) say("   Skipped: the allowlist has no NEAR account. Add one in Oiko → Agents.");
  else {
    const perTx = BigInt(me.caps.per_tx.units);
    const left = min(BigInt(me.caps.day.remaining.units), BigInt(me.caps.week.remaining.units));
    // Deterministic: two payments that fit, then a third that cannot (over what is left, or over the per-payment cap).
    const a = min(perTx, left / 3n + 1n);
    if (a === 0n || 2n * a > left || 2n * a > spend) {
      say(`   Skipped: not enough left (limits ${formatAmount(left.toString())}, Spend ${formatAmount(spend.toString())} ${token.toUpperCase()}).`);
    } else {
      await pay(c, token, a, payee, 1);
      await pay(c, token, a, payee, 2);
      const remaining = left - 2n * a;
      const third = remaining + 1n <= perTx ? remaining + 1n : perTx + 1n;
      say(`   Third payment: ${formatAmount(third.toString())} ${token.toUpperCase()} (${third > perTx ? "over the per-payment limit" : `only ${formatAmount(remaining.toString())} left in this window`})`);
      await pay(c, token, third, payee, 3);
    }
  }

  if (verifyRevoke) {
    step(5, "Revoke check");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("   Open Oiko → Agents, tap Disconnect on this agent, then press Enter… ");
    rl.close();
    for (let i = 0; i < 20; i++) {
      try {
        await c.get("/api/agent/overview");
        say("   Still connected, retrying in 3 s…");
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e) {
        say(`   ✓ Reads now fail: ${explain(e)}`);
        return;
      }
    }
    say("   ✗ Reads still work after 60 s. Did the Disconnect go through?");
  }
  say("\nDone.");
}

main().catch((e) => {
  console.error(`\nStopped: ${explain(e)}`);
  process.exit(1);
});
