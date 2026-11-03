"use client";
import { ErrorBox } from "@/components/ui";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <ErrorBox
      message="Layanan tidak tersedia atau akses akun berubah. Periksa konfigurasi server dan login kembali."
      retry={retry}
    />
  );
}
