// Backwards compatibility for private labels: readers that can't open sealed labels (agents built before Veil, hosted
// MCP, webhooks, push notifications) get "Private" or neutral wording, never raw ciphertext; readers with the view key
// opt in to the tokens; plain labels from accounts that never used Veil pass through unchanged.
import { describe, expect, it } from "vitest";
import { PRIVATE_LABEL, Veil, generateKeyPair } from "@oiko/sdk";
import { LABELS_HEADER, forReader, labelModeOf, plainLabel } from "../labels";
import { MemoryStore } from "../store";
import { deliver, registerWebhook, webhookKey, type Webhook } from "../webhooks";
import type { OikoEvent } from "../events";

const veil = Veil.fromOwnerKey(generateKeyPair().secretKey, "ada.oiko.testnet");
const rent = veil.seal("Rent");
const req = (h: Record<string, string> = {}) => new Request("http://x/api/agent/overview", { headers: h });

describe("label mode", () => {
  it("is masked by default (agents built before Veil) and sealed only on request", () => {
    expect(labelModeOf(req())).toBe("masked");
    expect(labelModeOf(req({ [LABELS_HEADER]: "SEALED " }))).toBe("sealed");
    expect(labelModeOf(req({ [LABELS_HEADER]: "raw" }))).toBe("masked");
  });
  it("masks tokens anywhere in a response, leaves plain labels alone", () => {
    const body = { pots: [{ id: 1, name: rent }, { id: 2, name: "Holiday" }], events: [{ title: `${rent} is due tomorrow` }] };
    expect(forReader(body, "masked")).toEqual({ pots: [{ id: 1, name: PRIVATE_LABEL }, { id: 2, name: "Holiday" }], events: [{ title: `${PRIVATE_LABEL} is due tomorrow` }] });
    expect(forReader(body, "sealed")).toEqual(body);
    expect(JSON.stringify(forReader(body, "masked"))).not.toContain("\u{1F512}");
  });
  it("push notifications use neutral wording for a private name", () => {
    expect(plainLabel(rent, "A bill")).toBe("A bill");
    expect(plainLabel("Internet", "A bill")).toBe("Internet");
  });
});

describe("webhooks and private labels", () => {
  const ev = { id: "e1", type: "bill_due_soon", at: new Date(1_000).toISOString(), title: `${rent} is due in 3 days`, suggested_actions: [] } as unknown as OikoEvent;
  async function sentWith(labels?: "masked" | "sealed") {
    const s = new MemoryStore();
    await registerWebhook(s, "vault.ada.oiko.testnet", "ed25519:pk", "https://agent.example.com/hook", 1_000, labels);
    const w = (await s.getSetting<Webhook>(webhookKey("vault.ada.oiko.testnet", "ed25519:pk")))!;
    const bodies: string[] = [];
    await deliver(s, w, [ev], 2_000, async (_u, body) => { bodies.push(body); return { ok: true, status: 200 }; });
    return bodies[0]!;
  }
  it("deliver \"Private\" by default (webhooks registered before Veil have no setting)", async () => {
    const body = await sentWith();
    expect(body).toContain(`${PRIVATE_LABEL} is due in 3 days`);
    expect(body).not.toContain("\u{1F512}");
  });
  it("deliver tokens to an agent that registered with labels: sealed, and it can open them", async () => {
    const body = await sentWith("sealed");
    const title = (JSON.parse(body) as { events: Array<{ title: string }> }).events[0]!.title;
    expect(veil.openText(title)).toBe("Rent is due in 3 days");
  });
});
