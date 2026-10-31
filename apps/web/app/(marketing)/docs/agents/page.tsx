import type { Metadata } from "next";
import { CopyLine } from "@/components/marketing/CopyLine";
import { REPO } from "@/components/marketing/Footer";
import { Block, PageHero } from "@/components/marketing/Prose";

export const metadata: Metadata = {
  title: "Agent docs",
  description: "Connect any AI agent to Oiko through MCP or a signed REST API, inside limits the account enforces.",
};

const links: Array<[string, string, string]> = [
  ["Agent guide on GitHub", `${REPO}/tree/main/docs`, "Scopes, caps, proposals and the full tool list."],
  ["HTTP interface", `${REPO}/blob/main/docs/interfaces/http.md`, "Every gateway endpoint and the NEP-413 auth header."],
  ["MCP server source", `${REPO}/tree/main/packages/mcp`, "Stdio and streamable HTTP; signs locally with the agent key."],
  ["oiko-agent.json", "/.well-known/oiko-agent.json", "Machine-readable tools, auth, limits and endpoints."],
  ["llms.txt", "/llms.txt", "A plain-text guide written for agents."],
];

export default function AgentDocs() {
  return (
    <>
      <PageHero eyebrow="Agents and developers" title="Let any agent manage money safely." lead="Oiko has no built-in AI. People connect the agent they already use. These docs live on GitHub, next to the code." />
      <Block title="Install">
        <div className="rounded-card bg-[var(--mk-ink-bg)] p-4 text-[var(--mk-ink-text)]"><CopyLine text="npx @oiko/mcp" /></div>
        <p>Or call <strong>POST /api/mcp</strong> (streamable HTTP). Every request is signed with the agent&rsquo;s own key (NEP-413) and checked by the person&rsquo;s account against their caps, payees and expiry.</p>
      </Block>
      <Block title="Read more" tone="grey">
        <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface">
          {links.map(([l, h, d]) => (
            <li key={l}>
              <a href={h} className="block px-6 py-4 hover:bg-surface-2" {...(h.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                <span className="block text-[16px] font-semibold text-ink">{l}</span>
                <span className="block text-[14px]">{d}</span>
              </a>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}
