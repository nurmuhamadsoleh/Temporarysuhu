"use client";
import { ConfigProvider } from "antd";
import idID from "antd/locale/id_ID";
import { Toaster } from "sonner";
import { appTheme } from "@/config/design";

export function UIProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <ConfigProvider
      locale={idID}
      theme={appTheme}
      csp={nonce ? { nonce } : undefined}
    >
      {children}
      <Toaster
        richColors
        position="top-right"
        closeButton
        toastOptions={{ className: "app-toast" }}
      />
    </ConfigProvider>
  );
}
