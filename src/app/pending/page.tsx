import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AccountActions } from "@/components/auth/AccountActions";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (!s) redirect("/login");
  if (s.user.status !== "PENDING") redirect("/auth/continue");
  return (
    <AuthFrame>
      <span className="eyebrow">MENUNGGU PERSETUJUAN ADMINISTRATOR</span>
      <h2>Registrasi Berhasil</h2>
      <p className="muted">
        Akun Google Anda telah terdaftar dan sedang menunggu persetujuan
        administrator PT Boga Rasa Tama.
      </p>
      <div className="account-summary">
        <strong>{s.user.name}</strong>
        <p>{s.user.email}</p>
        <span className="status">PENDING</span>
      </div>
      <AccountActions />
    </AuthFrame>
  );
}
