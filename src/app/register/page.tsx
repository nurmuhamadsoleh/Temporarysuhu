import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions, googleConfigured } from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { AccountActions } from "@/components/auth/AccountActions";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (s?.user.status === "ACTIVE") redirect("/dashboard");
  if (s?.user.status === "PENDING") redirect("/pending");
  if (s && ["REJECTED", "SUSPENDED"].includes(s.user.status))
    redirect("/account-status");
  return (
    <AuthFrame>
      <span className="eyebrow">DAFTAR AKUN TEMPCONTROL</span>
      <h2>Buat Akun TempControl</h2>
      <p className="muted">
        Daftarkan akun Google Anda untuk mengakses sistem monitoring suhu PT
        Boga Rasa Tama.
      </p>
      <GoogleButton register configured={googleConfigured()} />
      <p className="sop-notice">
        Pendaftaran memerlukan persetujuan administrator. Akun baru belum
        memiliki akses ke workspace.
      </p>
      <Link href="/login" className="text-link">
        Sudah memiliki akun? Kembali ke Login
      </Link>
      {s && <AccountActions />}
    </AuthFrame>
  );
}
