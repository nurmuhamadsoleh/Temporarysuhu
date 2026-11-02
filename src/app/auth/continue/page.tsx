import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (!s) redirect("/login");
  redirect(
    s.user.status === "ACTIVE"
      ? "/dashboard"
      : s.user.status === "PENDING"
        ? "/pending"
        : s.user.status === "UNREGISTERED"
          ? "/register"
          : "/account-status",
  );
}
