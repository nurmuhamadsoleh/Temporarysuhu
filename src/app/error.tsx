"use client";
import { AuthFailure } from "@/components/auth/AuthFailure";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return <AuthFailure retry={retry} />;
}
