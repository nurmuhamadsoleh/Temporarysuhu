import { listUsers } from "@/lib/server/user-api";
export const runtime = "nodejs";
export async function GET(req: Request) {
  return listUsers(req);
}
