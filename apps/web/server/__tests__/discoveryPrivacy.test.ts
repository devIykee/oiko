// Agent-facing discovery documents describe private labels (docs/PRIVACY.md).
import { expect, it } from "vitest";
import { agentManifest, llmsTxt, openApiDocument } from "../discovery";

it("openapi, oiko-agent.json and llms.txt document private labels and X-Oiko-Labels", () => {
  const d = openApiDocument() as { paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }> };
  expect(d.paths["/api/agent/overview"]!.get!.parameters![0]!.name).toBe("X-Oiko-Labels");
  expect(d.paths["/api/agent/activity"]!.get!.parameters!.map((p) => p.name)).toEqual(["X-Oiko-Labels", "limit"]);
  const m = agentManifest() as { private_labels: { view_key: string }; auth: { key: string } };
  expect(m.private_labels.view_key).toContain("X-Oiko-Labels: sealed");
  expect(m.auth.key).toContain("vk?");
  expect(llmsTxt()).toContain("Private labels (Veil)");
});
