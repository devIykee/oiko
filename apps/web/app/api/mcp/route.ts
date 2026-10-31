import { handleMcp } from "@/server/mcp";

export async function POST(req: Request) {
  return handleMcp(req);
}
export async function GET(req: Request) {
  return handleMcp(req);
}
export async function DELETE(req: Request) {
  return handleMcp(req);
}
