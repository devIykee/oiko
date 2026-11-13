// Oiko end-to-end tests (local mode). Each title starts with a stable id that README.md can reference as `[e2e: README-n]`.
// Run against `pnpm local` or `docker compose up`:  pnpm e2e
import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GatewayClient, decodeConnectionString, friendlyError, generateKeyPair, toUnits, type Overview } from "../packages/sdk/src/index.ts";
import {
  BASE, TRON_REFUND, apiUser, claimNameUI, config, fund, loginAs, payFromTron, relayerCall, rpc, until, vaultOf, waitForPayScreen, waitForUsdt, type Session,
} from "./helpers";

const ROOT = join(__dirname, "..");
const potBy = (o: Overview, kind: string) => o.pots.find((p) => p.kind === kind)!;
const share = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10_000n;
/** Two amounts in base units are equal up to 2 units of rounding. */
const close = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= 2n;

test.describe.serial("money flow for one person", () => {
  let me: Session;
  let firstPayment = 0n;

  test("README-1 claim a name", async ({ page }) => {
    const name = `e2e${Date.now().toString(36).slice(-6)}`;
    me = await claimNameUI(page, name);
    const cfg = await config();
    expect(me.accountId).toBe(`${name}.${cfg.root}`);
    await expect(page.getByTestId("home")).toContainText(me.accountId);
    // The savings account exists and has no access keys at all (so no full-access key).
    const keys = await (await rpc()).viewAccessKeyList(me.vaultId);
    expect(keys.length).toBe(0);
    // Default plan from the first-run screen: Bills 30%, Savings 20%, Rainy day 10% (locked pot), Goal 10%, rest (30%) to Spend.
    const o = await (await vaultOf(me)).overview();
    const bps = Object.fromEntries(o.splits.map((r) => [o.pots.find((p) => p.id === r.pot_id)!.kind, Number(r.value)]));
    expect(bps).toMatchObject({ bills: 3000, autosave: 2000, locked: 1000, goal: 1000 });
    expect(o.pots.some((p) => p.kind === "locked")).toBe(true);
  });

  test("README-2 get paid 100 USDT from USDT on TRON, split across pots", async ({ page, browser }) => {
    firstPayment = await payFromTron(browser, me.name, "100");
    expect(firstPayment).toBeGreaterThan(BigInt(toUnits("95")));
    await waitForUsdt(me, firstPayment);
    const o = await (await vaultOf(me)).overview();
    expect(BigInt(o.totals.usdt)).toBe(firstPayment);
    expect(close(BigInt(potBy(o, "bills").balances.usdt), share(firstPayment, 3000))).toBe(true);
    expect(close(BigInt(potBy(o, "autosave").balances.usdt), share(firstPayment, 2000))).toBe(true);
    expect(close(BigInt(potBy(o, "goal").balances.usdt), share(firstPayment, 1000))).toBe(true);
    expect(close(BigInt(potBy(o, "locked").balances.usdt), share(firstPayment, 1000))).toBe(true);
    expect(close(BigInt(potBy(o, "flex").balances.usdt), share(firstPayment, 3000))).toBe(true);

    await loginAs(page, me);
    await page.goto("/home");
    const whole = (u: bigint) => (Number(u / 10_000n) / 100).toFixed(2);
    await expect(page.getByTestId("balance-usdt")).toContainText(whole(firstPayment));
    await expect(page.getByTestId(`pot-card-${potBy(o, "bills").id}`)).toContainText(whole(BigInt(potBy(o, "bills").balances.usdt)));
  });

  test("README-3 change Bills to 40% and the next payment puts 40% in Bills", async ({ page, browser }) => {
    const v = await vaultOf(me);
    const before = await v.overview();
    const bills = potBy(before, "bills");
    await loginAs(page, me);
    await page.goto("/plan");
    await page.getByTestId("plan-edit").click();
    await page.getByTestId(`plan-slider-${bills.id}`).fill("4000");
    await page.getByTestId("plan-save").click();
    await until(async () => (await v.overview()).splits.some((r) => r.pot_id === bills.id && r.value === "4000"), 60_000);
    await expect(page.getByTestId("plan-preview")).toContainText("40");

    const paid = await payFromTron(browser, me.name, "100");
    await waitForUsdt(me, BigInt(before.totals.usdt) + paid);
    const after = await v.overview();
    const delta = BigInt(potBy(after, "bills").balances.usdt) - BigInt(bills.balances.usdt);
    expect(close(delta, share(paid, 4000))).toBe(true);
  });

  test("README-4 a locked pot refuses withdrawals", async ({ page }) => {
    const v = await vaultOf(me);
    let o = await v.overview();
    const rainy = potBy(o, "locked");
    expect((await v.moveFunds(potBy(o, "flex").id, rainy.id, "usdt", toUnits("1"))).ok).toBe(true);
    const unlock = BigInt(Date.now() + 30 * 86_400_000) * 1_000_000n;
    expect((await v.lock(rainy.id, unlock.toString())).ok).toBe(true);
    const held = BigInt((await v.overview()).pots.find((p) => p.id === rainy.id)!.balances.usdt);

    // The account itself refuses, with the friendly message the app shows.
    const r = await v.withdraw(rainy.id, "usdt", toUnits("1"), (await config()).relayer!);
    expect(r.ok).toBe(false);
    const f = friendlyError(`${r.errorCode} ${r.errorMessage}`);
    expect(f.code).toBe("E_LOCKED");
    expect(f.title).toBe("This pot is locked.");

    // The app shows the lock and offers no way out of the pot.
    await loginAs(page, me);
    await page.goto(`/pots/${rainy.id}`);
    await expect(page.getByTestId("pot-locked")).toBeVisible();
    await expect(page.getByTestId("pot-move-out")).toBeDisabled();
    await page.goto("/withdraw");
    await expect(page.getByRole("radio", { name: new RegExp(rainy.name) })).toBeDisabled();
    o = await v.overview();
    expect(BigInt(o.pots.find((p) => p.id === rainy.id)!.balances.usdt)).toBe(held);
  });

  test("README-5 withdraw 1 USDT from Spend", async ({ page }) => {
    const payee = await apiUser("payee");
    const v = await vaultOf(me);
    const before = BigInt(potBy(await v.overview(), "flex").balances.usdt);
    await loginAs(page, me);
    await page.goto("/withdraw");
    await page.getByRole("radio", { name: /Spend/ }).click();
    await page.getByTestId("withdraw-oiko").click();
    await page.getByTestId("withdraw-address").fill(payee.name);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("withdraw-amount").fill("1");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("withdraw-sentence")).toContainText(payee.name);
    await page.getByTestId("withdraw-confirm").click();
    await expect(page.getByText(/arrived|on its way/i).first()).toBeVisible({ timeout: 60_000 });
    await until(async () => BigInt(potBy(await v.overview(), "flex").balances.usdt) === before - BigInt(toUnits("1")), 60_000);
    await waitForUsdt(payee, BigInt(toUnits("1")));
  });

  test("README-6 agent with a 5 USDT cap: two payments pass, the third is refused, Disconnect cuts it off", async ({ page }) => {
    const cfg = await config();
    await loginAs(page, me);
    await page.goto("/agents");
    await page.getByTestId("agent-template-custom").click();
    await page.getByLabel("Agent name").fill("Example agent");
    await page.getByTestId("agent-scope-act").click();
    await page.getByRole("switch", { name: "Pay people on its list" }).click();
    await page.getByLabel("Who it can pay").fill(cfg.relayer!);
    await page.getByLabel("Per payment").fill("2");
    await page.getByLabel("Per day").fill("5");
    await page.getByLabel("Per week").fill("5");
    await page.getByTestId("agent-continue").click();
    await page.getByTestId("agent-allow").click();
    const mcp = JSON.parse((await page.getByTestId("agent-mcp").textContent()) ?? "{}");
    const connection: string = mcp.mcpServers.oiko.env.OIKO_CONNECTION;
    expect(connection).toMatch(/^oiko1?:/);

    // The scripted example agent (examples/agents/scripted): reads, proposes, pays twice, third payment refused.
    const out = spawnSync("pnpm", ["--silent", "example:agent"], { cwd: ROOT, env: { ...process.env, OIKO_CONNECTION: connection, OIKO_EXAMPLE_PAYEE: cfg.relayer! }, encoding: "utf8", timeout: 120_000 });
    const text = `${out.stdout}\n${out.stderr}`;
    expect(text.match(/✓ Paid/g)?.length ?? 0, text).toBe(2);
    expect(text, text).toMatch(/✗ Refused: .*\[E_CAP_/);

    // Disconnect deletes the agent's key; its reads are refused afterwards.
    await page.keyboard.press("Escape");
    await page.goto("/agents");
    await page.locator('[data-testid^="agent-card-"][data-testid$="-disconnect"]').first().click();
    // Disconnect asks first, then shows "Agent disconnected" until the sheet is closed.
    await page.getByTestId("agent-disconnect-confirm").click();
    await expect(page.getByTestId("agent-disconnect").getByText("Agent disconnected", { exact: true })).toBeVisible({ timeout: 60_000 });
    const agent = new GatewayClient(decodeConnectionString(connection));
    await until(async () => { try { await agent.get("/api/agent/overview"); return false; } catch { return true; } }, 60_000, 2000);
    const keys = await (await rpc()).viewAccessKeyList(me.vaultId);
    expect(keys.length).toBe(0);
  });

  test("README-7 a bill paid by an agent shows Paid", async ({ page }) => {
    const cfg = await config();
    const v = await vaultOf(me);
    const o = await v.overview();
    const day = new Date().getUTCDate();
    expect((await v.addBill({ name: "Internet", amount: toUnits("3"), token: "usdt", due_day: Math.min(day, 28), payee: cfg.relayer!, pot_id: potBy(o, "bills").id })).ok).toBe(true);
    const bill = (await v.bills()).find((b) => b.name === "Internet")!;
    const key = generateKeyPair();
    const exp = BigInt(Date.now() + 7 * 86_400_000) * 1_000_000n;
    expect((await v.addAgent(key.publicKey, {
      label: "Bill payer", agent_name: "Bill payer", agent_url: "https://example.com", scopes: ["read", "propose", "act"], allowed_actions: ["pay"],
      allowlist: [{ type: "near", account_id: cfg.relayer! }], per_tx: toUnits("5"), daily: toUnits("5"), weekly: toUnits("5"), expires_at: exp.toString(),
    } as never)).ok).toBe(true);
    const agent = new GatewayClient({ api: BASE, vault: me.vaultId, sk: key.secretKey });
    const r = await agent.run("act", { type: "pay_bill", bill_id: bill.id } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await loginAs(page, me);
    await page.goto("/bills");
    await expect(page.getByTestId(`bill-row-${bill.id}`)).toContainText("Paid");
    await v.revokeAgent(key.publicKey);
  });

  test("README-14 an agent suggests a plan change, the owner approves it, and the agent sees events and a refusal with how_to_fix", async ({ page }) => {
    const v = await vaultOf(me);
    const before = await v.overview();
    const bills = potBy(before, "bills"), savings = potBy(before, "autosave");
    const key = generateKeyPair();
    const exp = BigInt(Date.now() + 7 * 86_400_000) * 1_000_000n;
    expect((await v.addAgent(key.publicKey, {
      label: "Coach", agent_name: "Coach", agent_url: "https://example.com", scopes: ["read", "propose", "act"], allowed_actions: ["save"],
      allowlist: [], per_tx: toUnits("1"), daily: toUnits("5"), weekly: toUnits("5"), expires_at: exp.toString(),
    } as never)).ok).toBe(true);
    const agent = new GatewayClient({ api: BASE, vault: me.vaultId, sk: key.secretKey });

    // Events: the payments from earlier tests show up, oldest first, with a cursor.
    const ev = await agent.get<{ events: Array<{ type: string; id: string }>; cursor: string }>("/api/agent/events");
    expect(ev.events.some((e) => e.type === "payment_received"), JSON.stringify(ev)).toBe(true);
    expect((await agent.get<{ events: unknown[] }>(`/api/agent/events?since=${encodeURIComponent(ev.cursor)}`)).events).toEqual([]);
    const brief = await agent.get<{ money_in: { units: string }; facts: string[] }>("/api/agent/brief");
    expect(BigInt(brief.money_in.units) > 0n).toBe(true);

    // Over the per-payment cap: refused by the account, with a concrete next step.
    const r = await agent.run("act", { type: "save", to_pot: savings.id, token: "usdt", amount: toUnits("2") } as never);
    expect(r.ok).toBe(false);
    expect(r.error?.how_to_fix ?? "", JSON.stringify(r)).toMatch(/per-payment cap is 1\.00/);

    // A non-money suggestion, approved by the owner on Home, carried out with the app key.
    const rules = [{ pot_id: bills.id, mode: "percent", value: "3500" }, { pot_id: savings.id, mode: "percent", value: "2500" }];
    const p = await agent.request<{ id: string; status: string; summary: string }>("POST", "/api/agent/change", { change: { type: "set_splits", rules }, reason: "Bills went up; this covers them." });
    expect(p.status).toBe("pending");
    expect(p.summary).toMatch(/35%/);
    await loginAs(page, me);
    await page.goto("/home");
    await page.getByTestId(`change-${p.id}-approve`).click();
    await page.getByTestId("change-confirm-confirm").click();
    await until(async () => (await v.overview()).splits.some((x) => x.pot_id === bills.id && x.value === "3500"), 60_000);
    await until(async () => (await agent.get<{ changes: Array<{ id: string; status: string }> }>("/api/agent/changes")).changes.find((c) => c.id === p.id)?.status === "approved", 30_000);

    // Autopilot: the owner turns a rule on in Agents; the agent reads it.
    await page.goto("/agents");
    await page.getByTestId("autopilot-topup").click();
    await page.getByTestId("autopilot-save").click();
    await until(async () => (await agent.get<{ autopilot: { top_up_bills: { on: boolean } } }>("/api/agent/autopilot")).autopilot.top_up_bills.on, 30_000);
    await v.revokeAgent(key.publicKey);
  });

  test("README-8 Earn is refused when the lending pool is 93% borrowed", async ({ page }) => {
    const cfg = await config();
    const big = 10n ** 24n;
    const setUtil = (bps: bigint) => relayerCall(cfg.contracts.lending!, "set_state", { token_id: cfg.contracts.usdt, supplied: big.toString(), borrowed: ((big * bps) / 10_000n).toString(), apy_bps: 500 });
    expect((await setUtil(9300n)).ok).toBe(true);
    try {
      const v = await vaultOf(me);
      const bills = potBy(await v.overview(), "bills");
      // The account checks utilization itself before every deposit.
      const r = await v.earnOn(bills.id, "usdt", toUnits("1"));
      expect(r.ok).toBe(false);
      expect(friendlyError(`${r.errorCode} ${r.errorMessage}`).code).toBe("E_UTILIZATION");
      // The app shows Earn as paused and won't offer the deposit (rates are cached for up to a minute).
      await loginAs(page, me);
      await until(async () => {
        await page.goto(`/pots/${bills.id}`);
        await page.getByTestId("pot-earn-toggle").click();
        const paused = await page.getByText("Earn is paused for this stablecoin").isVisible({ timeout: 5000 }).catch(() => false);
        return paused;
      }, 90_000, 5000);
      await expect(page.getByTestId("earn-sheet").getByRole("button", { name: /Continue|Start|Earn/ }).last()).toBeDisabled();
    } finally {
      await setUtil(5000n);
    }
  });

  test("README-10 reduced motion: Home runs no looping animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAs(page, me);
    await page.goto("/home");
    await expect(page.getByTestId("balance")).toBeVisible();
    await page.waitForTimeout(1500);
    const moving = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => ({ name: (a as CSSAnimation).animationName ?? a.constructor.name, t: a.effect?.getComputedTiming() }))
      .filter((a) => a.t && (a.t.iterations === Infinity || Number(a.t.duration) > 50)));
    expect(moving).toEqual([]);
  });

  test("README-11 360px wide: no horizontal scroll on the main pages", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await loginAs(page, me);
    for (const path of ["/", "/start", `/pay/${me.name}`, "/home", "/plan", "/pots", "/bills", "/agents", "/rosca", "/withdraw", "/insights", "/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(w.scroll, `${path} is ${w.scroll}px wide`).toBeLessThanOrEqual(w.client + 1);
    }
  });
});

test("README-9 ROSCA: create with 1-minute rounds and 3 people, start, pay, settle", async ({ page }) => {
  test.setTimeout(300_000);
  const cfg = await config();
  const [org, m1, m2] = await Promise.all([apiUser("rosa"), apiUser("rosb"), apiUser("rosc")]);
  for (const u of [org, m1, m2]) await fund(u, "20");
  for (const u of [org, m1, m2]) await waitForUsdt(u, BigInt(toUnits("20")));

  await loginAs(page, org);
  await page.goto("/rosca/new");
  await page.getByLabel("Group name").fill("Test circle");
  await page.getByLabel("Each person puts in").fill("5");
  await page.getByRole("radio", { name: "Every minute (test mode)" }).click();
  await page.getByLabel("How many people").fill("3");
  await page.getByRole("switch", { name: "Bond" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start ROSCA" }).click();
  await page.waitForURL(/\/rosca\/\d+$/, { timeout: 60_000 });
  const id = Number(/\/rosca\/(\d+)$/.exec(page.url())![1]);
  const code = await page.evaluate((k) => localStorage.getItem(k), `oiko-rosca-invite-${id}`);
  expect(code).toBeTruthy();

  for (const m of [m1, m2]) expect((await (await vaultOf(m)).ajoJoin(id, code!)).ok).toBe(true);
  await page.reload();
  await page.getByTestId("rosca-start").click();
  await page.getByRole("button", { name: "Start the group" }).click();
  await expect(page.getByTestId("rosca-pay")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("rosca-pay").click();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByTestId("rosca-pay")).toBeDisabled({ timeout: 60_000 });
  for (const m of [m1, m2]) expect((await (await vaultOf(m)).ajoContribute(id, "usdt", toUnits("5"))).ok).toBe(true);

  // Anyone may settle once the 1-minute round is over; the first person in the order receives 15 USDT.
  const r = await rpc();
  const circle = await r.view<{ order: string[]; round: number }>(cfg.contracts.ajo!, "get_circle", { id });
  const first = [org, m1, m2].find((u) => u.vaultId === circle.order[0])!;
  const before = BigInt((await (await vaultOf(first)).overview()).totals.usdt);
  await until(async () => {
    const c = await r.view<{ round: number }>(cfg.contracts.ajo!, "get_circle", { id });
    if (c.round >= 1) return true;
    await relayerCall(cfg.contracts.ajo!, "settle_round", { circle_id: id }, 200n);
    return false;
  }, 150_000, 5000);
  await waitForUsdt(first, before + BigInt(toUnits("15")));
  await page.reload();
  await expect(page.getByTestId("rosca-pay")).toBeEnabled({ timeout: 30_000 });
});

test("README-13 an invoice paid from USDT on TRON shows Paid and lands in the CSV export", async ({ page, browser }) => {
  const me = await apiUser("inv");
  await loginAs(page, me);
  await page.goto("/invoices/new");
  await page.getByTestId("invoice-client").fill("Northwind Studio");
  await page.getByTestId("invoice-desc-0").fill("Logo design");
  await page.getByTestId("invoice-price-0").fill("12");
  await page.getByRole("radio", { name: "USDT" }).click();
  await page.getByTestId("invoice-create").click();
  await expect(page.getByTestId("invoice-sheet")).toBeVisible({ timeout: 60_000 });
  const href = await page.getByTestId("invoice-view").getAttribute("href");
  expect(href).toMatch(/^\/i\//);

  // The client pays the public invoice page in a fresh browser (fixed amount, so no amount step).
  const ctx = await browser.newContext({ baseURL: BASE });
  const payer = await ctx.newPage();
  try {
    await payer.goto(href!);
    await payer.getByTestId("invoice-pay-start").click();
    await payer.locator('[data-testid^="pay-origin-"]', { hasText: /TRON/i }).first().click();
    await payer.getByTestId("pay-refund").fill(TRON_REFUND);
    await payer.getByTestId("pay-continue-3").click();
    await payer.getByTestId("pay-simulate").click();
    await expect(payer.getByTestId("pay-done")).toBeVisible({ timeout: 120_000 });
  } finally {
    await ctx.close();
  }

  await until(async () => {
    await page.goto("/invoices");
    return /paid/i.test((await page.getByTestId(/^invoice-row-/).first().textContent()) ?? "");
  }, 120_000, 4000);
  const dl = page.waitForEvent("download");
  await page.getByTestId("invoices-export").click();
  const csv = readFileSync(await (await dl).path(), "utf8");
  expect(csv).toMatch(/Northwind Studio/);
  expect(csv.toLowerCase()).toContain("paid");
});

test("README-12 banned-words check passes", () => {
  // Exits non-zero (and execFileSync throws) when user-facing copy contains a banned word.
  execFileSync("node", ["scripts/check-copy.mjs"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
});

test("README-15 name boxes focus from anywhere inside them: side padding and the suffix (sign-up and landing hero)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/start");
  const input = page.getByTestId("start-name");
  const wrap = input.locator("xpath=..");
  const suffix = wrap.locator(".oi-input-affix");
  await input.fill("steve");
  const ring = () => wrap.evaluate((el) => el.matches(":focus-within") && getComputedStyle(el).boxShadow !== "none");

  // Left padding (14 px wide): focus moves into the field and the box shows its ring.
  await input.blur();
  await expect(input).not.toBeFocused();
  await wrap.click({ position: { x: 5, y: 26 } });
  await expect(input).toBeFocused();
  expect(await ring()).toBe(true);

  // The ".oiko…" suffix: focus, caret at the end, so typing continues the name.
  await input.blur();
  await suffix.click();
  await expect(input).toBeFocused();
  expect(await ring()).toBe(true);
  await page.keyboard.type("x");
  await expect(input).toHaveValue("stevex");

  // Right padding, past the suffix.
  await input.blur();
  const box = (await wrap.boundingBox())!;
  await wrap.click({ position: { x: box.width - 5, y: 26 } });
  await expect(input).toBeFocused();

  // Text inside the field still selects normally.
  await input.dblclick();
  expect(await input.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe("stevex");

  // The landing hero's own name box: the input hugs the typed name, the rest of the pill must still focus it.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const hero = page.getByRole("textbox", { name: "Choose your name" });
    const pill = hero.locator("xpath=ancestor::div[contains(@class, 'rounded-full')][1]");
    // Wait until the page is interactive: the hint under the box only changes once React runs (a fill before
    // hydration can be reset by it, hence the retry).
    await expect(async () => {
      await hero.fill("steve");
      const hint = page.locator(`[id="${await hero.getAttribute("aria-describedby")}"]`);
      await expect(hint).not.toHaveText("Your name becomes your pay link.", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await hero.blur();
    await pill.getByText(/^\.oiko/).click();
    await expect(hero).toBeFocused();
    expect(await pill.evaluate((el) => el.matches(":focus-within"))).toBe(true);
    await page.keyboard.type("x");
    await expect(hero).toHaveValue("stevex");
    // Empty space between the suffix and the button, and the left padding.
    const pb = (await pill.boundingBox())!;
    const bb = (await pill.getByRole("button").boundingBox())!;
    for (const x of [bb.x - pb.x - 6, 6]) {
      await hero.blur();
      await pill.click({ position: { x, y: pb.height / 2 } });
      await expect(hero).toBeFocused();
    }
    // The button still submits instead of just focusing.
    await pill.getByRole("button").click();
    await expect(page).toHaveURL(/\/start\?name=stevex/);
  }
});

test("README-16 paying from a Gloam private balance: off by default, opt-in when the flag is on", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const payee = await apiUser("priv");
  const EVM_REFUND = "0x000000000000000000000000000000000000dEaD";
  const toDeposit = async (origin: RegExp, refund: string) => {
    await page.goto(`/pay/${payee.name}`);
    await waitForPayScreen(page);
    await page.locator('[data-testid^="pay-origin-"]').filter({ hasText: origin }).first().click();
    await page.getByTestId("pay-amount").fill("100");
    await page.getByTestId("pay-continue-2").click();
    await page.getByTestId("pay-refund").fill(refund);
  };
  const noSideways = async () => {
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(w.scroll).toBeLessThanOrEqual(w.client + 1);
  };

  // Flag off (the default): no switch, no Gloam card, and the endpoint refuses.
  expect((await config()).features.privatePay).toBe(false);
  const off = await page.request.get(`/api/private-pay?asset=${encodeURIComponent("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near")}&amount=1000000`);
  expect(off.status()).toBe(404);
  await toDeposit(/USDC on Base/, EVM_REFUND);
  await expect(page.getByTestId("pay-private-toggle")).toHaveCount(0);
  await page.getByTestId("pay-continue-3").click();
  await expect(page.getByTestId("pay-deposit")).toBeVisible();
  await expect(page.getByTestId("pay-private")).toHaveCount(0);

  // Flag on (config rewritten in the browser; the fee endpoint itself is unit-tested): still off until the sender opts in.
  await page.route("**/api/config", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, features: { ...body.features, privatePay: true } } });
  });
  await page.route("**/api/private-pay?**", (route) => route.fulfill({ json: { receive: "100000000", feeBps: 50, cashOut: "100502512", chainId: 8453, source: "test" } }));

  await toDeposit(/USDT on TRON/, TRON_REFUND); // Gloam can't pay from TRON: no switch
  await expect(page.getByTestId("pay-private-toggle")).toHaveCount(0);

  await toDeposit(/USDC on Base/, EVM_REFUND);
  const toggle = page.getByTestId("pay-private-toggle");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/give one that isn't linked to you/)).toBeVisible();
  await noSideways();
  await page.getByTestId("pay-continue-3").click();
  const card = page.getByTestId("pay-private");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("pay-private-cashout")).toContainText("100.502512 USDC");
  await expect(page.getByTestId("pay-private-fee")).toContainText("0.5%");
  await expect(card).toContainText("Oiko never asks for your Gloam secret");
  await noSideways();

  // The payment itself is unchanged: same deposit address, same delivery.
  await page.getByTestId("pay-simulate").click();
  await expect(page.getByTestId("pay-done")).toBeVisible({ timeout: 120_000 });
});
