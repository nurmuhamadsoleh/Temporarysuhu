"use client";
import { AuthFailure } from "@/components/auth/AuthFailure";
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="id">
      <body style={{ margin: 0 }}>
        <title>TempControl — Layanan belum tersedia</title>
        <AuthFailure retry={retry} />
      </body>
    </html>
  );
}
