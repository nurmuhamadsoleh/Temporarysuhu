"use client";
import { signOut } from "next-auth/react";
export function AccountActions() {
  return (
    <button
      className="btn secondary mt-5"
      onClick={() => void signOut({ callbackUrl: "/login" })}
    >
      Kembali ke Login
    </button>
  );
}
