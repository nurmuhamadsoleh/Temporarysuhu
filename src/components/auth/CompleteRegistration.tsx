"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/ui";
import type { AppUser } from "@/lib/users";
export function CompleteRegistration() {
  const router = useRouter(),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api<AppUser>("/api/users/register", { method: "POST", body: "{}" })
      .then((u) => {
        if (!cancelled)
          router.replace(
            u.status === "ACTIVE"
              ? "/dashboard"
              : u.status === "PENDING"
                ? "/pending"
                : "/account-status",
          );
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Pendaftaran belum dapat dikonfirmasi. Coba lagi atau hubungi administrator.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);
  return (
    <>
      {error ? (
        <div role="alert">
          <p className="sop-notice">{error}</p>
          <button
            className="btn primary"
            onClick={() => {
              setError("");
              setAttempt(attempt + 1);
            }}
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <p role="status" className="muted my-6">
          Memverifikasi dan menyimpan pendaftaran…
        </p>
      )}
    </>
  );
}
