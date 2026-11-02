"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { LoaderCircle } from "lucide-react";
export function GoogleButton({
  register = false,
  configured,
}: {
  register?: boolean;
  configured: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="my-6">
      {!configured && (
        <p className="sop-notice" role="alert">
          Google Login belum dikonfigurasi. Hubungi administrator.
        </p>
      )}
      <button
        className="google-auth-button"
        disabled={busy || !configured}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await signIn("google", {
              callbackUrl: register ? "/register/complete" : "/auth/continue",
            });
          } catch {
            setBusy(false);
            setError("Autentikasi belum tersedia. Silakan coba lagi.");
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={20} className="animate-spin" />
        ) : (
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59C10.05 27.14 9.78 25.6 9.78 24s.27-3.14.75-4.59l-7.98-6.19A23.87 23.87 0 000 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        )}
        {busy
          ? "Menghubungkan…"
          : register
            ? "Daftar dengan Google"
            : "Masuk dengan Google"}
      </button>
      {error && (
        <p className="field-error mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
