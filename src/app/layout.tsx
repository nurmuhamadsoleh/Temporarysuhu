import type { Metadata } from "next";
import { headers } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { UIProvider } from "@/components/layout/UIProvider";
import "./globals.css";
export const metadata: Metadata = {
  title: "TempControl — Monitoring Suhu",
  description: "Monitoring Suhu Chiller & Freezer untuk operasional dapur",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="id">
      <body>
        <AntdRegistry>
          <UIProvider nonce={nonce}>{children}</UIProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
