import { requireActor } from "@/lib/server/auth";
import { Admin } from "@/components/Admin";
export default async function Page() {
  const actor = await requireActor(["ADMIN"]);
  return <Admin canManageUsers={actor.role === "SUPER_ADMIN"} />;
}
