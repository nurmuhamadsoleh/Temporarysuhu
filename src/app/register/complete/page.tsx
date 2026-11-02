import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/server/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { CompleteRegistration } from "@/components/auth/CompleteRegistration";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await getServerSession(authOptions);
  if (!s?.user.googleVerified) redirect("/register");
  return (
    <AuthFrame>
      <span className="eyebrow">PENDAFTARAN AKUN</span>
      <h2>Memproses registrasi</h2>
      <CompleteRegistration />
    </AuthFrame>
  );
}
