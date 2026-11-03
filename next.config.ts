import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  turbopack: { root: process.cwd() },
  outputFileTracingExcludes: {
    "/*": [
      "./.npm-cache/**/*",
      "./private-storage/**/*",
      "./tests/**/*",
      "./docs/**/*",
      "./tmp/**/*",
      "./output/**/*",
      "./client_secret*.json",
      "./service-account*.json",
      "./*-service-account*.json",
      "./google-credentials*.json",
      "./price-list-koperasi-*.json",
      "./.env*",
      "./**/*.p12",
      "./**/*.pfx",
    ],
  },
  serverExternalPackages: [
    "@signpdf/signpdf",
    "@signpdf/signer-p12",
    "node-forge",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          ...(process.env.NODE_ENV === "production" &&
          (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").startsWith(
            "https://",
          )
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
            : []),
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
