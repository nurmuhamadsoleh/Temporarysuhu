import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security/headers";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString("base64");
  const development = process.env.NODE_ENV === "development";
  const https =
    process.env.NODE_ENV === "production" &&
    (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").startsWith(
      "https://",
    );
  const policy = contentSecurityPolicy(nonce, development, https);
  const requestHeaders = new Headers(request.headers);
  // Never trust a nonce or CSP supplied by the client.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static/|_next/image|favicon.ico).*)"],
};
