import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingExcludes: {
    "/*": [
      "./.npm-cache/**/*",
      "./private-storage/**/*",
      "./tests/**/*",
      "./docs/**/*",
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
          ...(process.env.APP_ENV === "production"
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
