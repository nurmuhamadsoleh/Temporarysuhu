import { mutateUser, type UserContext } from "@/lib/server/user-api";
export const runtime = "nodejs";
export async function PATCH(req: Request, c: UserContext) {
  return mutateUser(req, c, "status");
}
