import { mutateUser, type UserContext } from "@/lib/server/user-api";
export const runtime = "nodejs";
export async function POST(req: Request, c: UserContext) {
  return mutateUser(req, c, "reject");
}
