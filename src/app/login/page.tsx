import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import {
  authOptions,
  googleConfigured,
  legacyEnabled,
} from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { GoogleButton } from "@/components/auth/GoogleButton";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getServerSession(authOptions);
  if (s?.user.status === "ACTIVE") redirect("/dashboard");
  if (s?.user.status === "PENDING") redirect("/pending");
  const { error } = await searchParams;
  return (
    <AuthFrame>
      <span className="eyebrow">Selamat Datang Kembali</span>
      <h2>Masuk ke Workspace TempControl</h2>
      <p className="muted">
        Gunakan akun Google yang telah terdaftar untuk mengakses sistem
        monitoring suhu.
      </p>
      {error && (
        <p role="alert" className="sop-notice mt-5">
          Login belum dapat diselesaikan. Pastikan akun memiliki izin atau
          hubungi administrator.
        </p>
      )}
      <GoogleButton configured={googleConfigured()} />
      <p className="muted">
        Belum memiliki akun?{" "}
        <Link href="/register" className="text-link">
          Daftar Sekarang
        </Link>
      </p>
      {legacyEnabled() && (
        <Link className="text-link block mt-5" href="/login/legacy">
          Akses akun lama (masa migrasi)
        </Link>
      )}
      <div className="login-security">
        <ShieldCheck size={18} />
        Identitas Google diverifikasi. Akses sesuai peran.
      </div>
    </AuthFrame>
  );
}
