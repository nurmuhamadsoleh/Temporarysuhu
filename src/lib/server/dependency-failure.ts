import { AppError } from "./errors";
import { startupDiagnostic } from "./startup-diagnostics.mjs";

export class FeatureUnavailable extends AppError {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly fields: string[] = [],
  ) {
    super(503, message);
    this.name = "FeatureUnavailable";
  }
}
export function googleFailureCode(error: unknown) {
  const e = error as {
    code?: unknown;
    name?: unknown;
    response?: { status?: number; data?: { error?: unknown } };
  };
  const status =
    e?.response?.status || (typeof e?.code === "number" ? e.code : 0);
  if (
    status === 401 ||
    (status === 400 && e.response?.data?.error === "invalid_grant")
  )
    return "GOOGLE_CREDENTIALS_REJECTED";
  if (status === 403) return "GOOGLE_SHEETS_FORBIDDEN";
  if (status === 404) return "GOOGLE_SHEETS_NOT_FOUND";
  if (
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ABORT_ERR"].includes(
      String(e?.code),
    ) ||
    ["AbortError", "TimeoutError"].includes(String(e?.name))
  )
    return "GOOGLE_SHEETS_TIMEOUT";
  return "GOOGLE_SHEETS_UNAVAILABLE";
}
export function databaseUnavailable(errorCode: string, fields: string[] = []) {
  startupDiagnostic(
    "google_sheets",
    "unavailable",
    errorCode,
    "WARNING",
    fields,
  );
  return new FeatureUnavailable(
    errorCode,
    "Google Sheets belum tersedia. Periksa konfigurasi, API dan izin service account.",
    fields,
  );
}
