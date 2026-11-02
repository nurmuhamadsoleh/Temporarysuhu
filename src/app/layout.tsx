import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { UIProvider } from "@/components/layout/UIProvider";
import "./globals.css";
export const metadata: Metadata = {
  title: "TempControl — Monitoring Suhu",
  description: "Monitoring Suhu Chiller & Freezer untuk operasional dapur",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <AntdRegistry>
          <UIProvider>{children}</UIProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
