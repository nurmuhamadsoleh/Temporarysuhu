import Link from "next/link";
import { redirect } from "next/navigation";
import { legacyEnabled } from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { LegacyLogin } from "@/components/auth/LegacyLogin";
export const dynamic = "force-dynamic";
export default function Page() {
  if (!legacyEnabled()) redirect("/login");
  return (
    <AuthFrame>
      <span className="eyebrow">MASA MIGRASI AKUN</span>
      <h2>Akses akun lama</h2>
      <p className="muted mb-5">
        Hanya akun lama yang belum ditautkan ke Google dapat menggunakan jalur
        ini.
      </p>
      <LegacyLogin />
      <Link href="/login" className="text-link mt-5">
        Kembali ke Google Login
      </Link>
    </AuthFrame>
  );
}
