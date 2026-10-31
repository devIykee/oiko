import { connection } from "next/server";
import { handle } from "@/server/http";
import { tokenGroups } from "@/server/intents";

export async function GET() {
  await connection();
  return handle(() => tokenGroups());
}
