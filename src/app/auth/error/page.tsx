import Link from "next/link";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { authErrorMessage } from "@/lib/auth-feedback";
export const dynamic = "force-dynamic";
// Deliberately independent of session/database lookup: it must render when those fail.
export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthFrame>
      <span className="eyebrow">TEMPCONTROL</span>
      <h2>Login belum berhasil</h2>
      <p className="sop-notice" role="alert">
        {authErrorMessage(error)}
      </p>
      <p className="muted">
        Akses workspace tetap memerlukan akun aktif yang telah disetujui.
      </p>
      <Link className="btn primary mt-5" href="/login">
        Kembali ke Login
      </Link>
      <Link className="text-link block mt-5" href="/register">
        Daftar akun Google
      </Link>
    </AuthFrame>
  );
}
