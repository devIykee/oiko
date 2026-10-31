import { handle, parseBody, readText } from "@/server/http";
import { pushSubscribe } from "@/server/public";
import { PushSubscribeBody } from "@/server/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    const text = await readText(req);
    return pushSubscribe(req, text, parseBody(PushSubscribeBody, text));
  });
}
