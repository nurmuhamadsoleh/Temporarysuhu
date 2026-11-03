const messages: Record<string, string> = {
  OAuthSignin:
    "Koneksi ke Google belum dapat dimulai. Coba lagi atau hubungi administrator.",
  OAuthCallback:
    "Login Google belum dapat diverifikasi. Coba lagi atau hubungi administrator.",
  AccessDenied:
    "Akses akun belum tersedia. Hubungi administrator untuk memeriksa status akun.",
  Configuration: "Layanan login belum tersedia. Hubungi administrator.",
  SessionRequired: "Silakan masuk untuk melanjutkan.",
};
export function authErrorCode(code: unknown) {
  return typeof code === "string" && Object.hasOwn(messages, code)
    ? code
    : "Default";
}
export function authErrorMessage(code?: string) {
  const safeCode = authErrorCode(code);
  return safeCode !== "Default"
    ? messages[safeCode]
    : "Login belum dapat diselesaikan. Coba lagi atau hubungi administrator.";
}
