export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  https: boolean,
) {
  if (!/^[A-Za-z0-9+/]+=*$/.test(nonce)) throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Ant Design, Chart.js, signature pad and responsive React styles use style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
