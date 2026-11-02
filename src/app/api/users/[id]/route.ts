import { getUser, mutateUser, type UserContext } from "@/lib/server/user-api";
export const runtime = "nodejs";
export const GET = getUser;
export async function PATCH(req: Request, c: UserContext) {
  return mutateUser(req, c, "profile");
}
