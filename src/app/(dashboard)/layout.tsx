import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions, requireActor } from "@/lib/server/auth";
import { Shell } from "@/components/layout/Shell";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.status !== "ACTIVE") redirect("/auth/continue");
  const actor = await requireActor();
  return <Shell actor={actor}>{children}</Shell>;
}
