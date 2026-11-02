import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authOrigin } from "./runtime-config.mjs";
import { safeLog } from "./safe-log";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const ok = (data: unknown, message = "Berhasil", status = 200) =>
  NextResponse.json(
    { success: true, data, message, error: null },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export function fail(error: unknown) {
  const requestId = crypto.randomUUID();
  if (!(error instanceof AppError) && !(error instanceof ZodError))
    safeLog("request_failed", "INTERNAL", requestId);
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof ZodError
        ? 400
        : 503;
  const message =
    error instanceof AppError
      ? error.message
      : error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : "Layanan belum tersedia. Periksa koneksi, akses Google Sheets, dan konfigurasi server.";
  return NextResponse.json(
    { success: false, data: null, message, error: { code: status } },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
    },
  );
}
export function originCheck(req: Request) {
  const expected = authOrigin();
  if (req.headers.get("origin") !== expected)
    throw new AppError(403, "Origin request tidak diizinkan");
}
