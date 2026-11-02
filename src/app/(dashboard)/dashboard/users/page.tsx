import { requireActor } from "@/lib/server/auth";
import { UsersManagement } from "@/components/users/UsersManagement";
export default async function Page() {
  await requireActor(["SUPER_ADMIN"]);
  return (
    <>
      <UsersManagement />
    </>
  );
}
