import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AccountActions } from "@/components/auth/AccountActions";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (!s) redirect("/login");
  if (["ACTIVE", "PENDING", "UNREGISTERED"].includes(s.user.status))
    redirect("/auth/continue");
  return (
    <AuthFrame>
      <span className="eyebrow">STATUS AKUN</span>
      <h2>Akses belum tersedia</h2>
      <p className="sop-notice">
        {s.user.status === "REJECTED"
          ? "Pendaftaran akun Anda ditolak."
          : "Akun Anda dinonaktifkan."}{" "}
        Hubungi administrator PT Boga Rasa Tama untuk informasi lebih lanjut.
      </p>
      <AccountActions />
    </AuthFrame>
  );
}
