import { connection } from "next/server";
import { agentCreateAccount } from "@/server/agentSignup";
import { clientIp, handle, readBody } from "@/server/http";
import { AgentCreateAccountBody } from "@/server/schemas";

// POST /api/agent/create-account
// Self-service account creation for agents. No passkey, no human clicking required.
// The agent generates its own ed25519 keypair, proves possession, and gets a name + vault.
// See docs/AGENTS.md "Autonomous agent setup" for the full flow.
export async function POST(req: Request) {
  await connection();
  return handle(async () => agentCreateAccount(await readBody(req, AgentCreateAccountBody), clientIp(req)));
}
