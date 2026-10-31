import { connection } from "next/server";
import { checkCronAuth, runCron } from "@/server/cron";
import { handle } from "@/server/http";

async function run(req: Request) {
  return handle(async () => {
    checkCronAuth(req);
    return runCron();
  });
}
/** Vercel Cron sends GET with Authorization: Bearer $CRON_SECRET; GitHub Actions may POST. */
export async function GET(req: Request) {
  await connection();
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
