"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
export function LegacyLogin() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    router = useRouter();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          const r = await signIn("credentials", {
            email: f.get("email"),
            password: f.get("password"),
            redirect: false,
          });
          if (r?.error)
            setError(
              "Akun tidak dapat masuk. Gunakan Google atau hubungi administrator.",
            );
          else router.push("/auth/continue");
        } catch {
          setError("Layanan login belum tersedia.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Email
        <input name="email" type="email" required autoComplete="username" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          maxLength={72}
          autoComplete="current-password"
        />
      </label>
      {error && (
        <p role="alert" className="field-error my-3">
          {error}
        </p>
      )}
      <button className="btn primary w-full" disabled={busy}>
        {busy ? "Memverifikasi…" : "Masuk akun lama"}
      </button>
    </form>
  );
}
