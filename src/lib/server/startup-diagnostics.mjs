const components = {
  authentication: "Authentication configuration",
  google_sheets: "Google Sheets",
  private_storage: "Private storage",
  pdf_signing: "Certificate PDF signing",
};
const allowedCodes = new Set([
  "AUTH_CONFIG_INVALID",
  "AUTH_CONFIG_VALID",
  "DATABASE_CONFIG_INVALID",
  "DATABASE_CONFIG_VALID",
  "STORAGE_CONFIG_INVALID",
  "STORAGE_CONFIG_VALID",
  "STORAGE_READY",
  "STORAGE_UNAVAILABLE",
  "SIGNING_CONFIG_INVALID",
  "SIGNING_CONFIG_VALID",
  "SIGNING_DISABLED",
  "SIGNING_READY",
  "SIGNING_UNAVAILABLE",
  "GOOGLE_CREDENTIALS_INVALID",
  "GOOGLE_CREDENTIALS_REJECTED",
  "GOOGLE_SHEETS_FORBIDDEN",
  "GOOGLE_SHEETS_NOT_FOUND",
  "GOOGLE_SHEETS_TIMEOUT",
  "GOOGLE_SHEETS_UNAVAILABLE",
  "GOOGLE_SHEETS_SCHEMA_MISMATCH",
  "GOOGLE_SHEETS_READY",
  "STORAGE_ENOENT",
  "STORAGE_EACCES",
  "STORAGE_EROFS",
  "STORAGE_ENOSPC",
  "CERTIFICATE_INVALID",
  "CERTIFICATE_ENOENT",
  "CERTIFICATE_EACCES",
  "OPENSSL_UNAVAILABLE",
  "OPENSSL_ENOENT",
]);
/** Never serialize an Error, path, request body, token or environment value. */
export function startupDiagnostic(
  component,
  status,
  errorCode,
  severity = "INFO",
  fields = [],
) {
  if (
    !Object.hasOwn(components, component) ||
    !["configured", "ready", "disabled", "failed", "unavailable"].includes(
      status,
    ) ||
    !["INFO", "WARNING", "CRITICAL"].includes(severity) ||
    !allowedCodes.has(errorCode)
  )
    throw new Error("Invalid diagnostic metadata");
  const entry = {
    at: new Date().toISOString(),
    event: "startup_check",
    component,
    status,
    severity,
    errorCode,
    category: errorCode.includes("CONFIG")
      ? "CONFIGURATION"
      : errorCode.startsWith("GOOGLE_")
        ? "DATABASE"
        : component === "private_storage"
          ? "FILESYSTEM"
          : component === "pdf_signing"
            ? "OPTIONAL_FEATURE"
            : "AUTHENTICATION",
    message: `${components[component]}: ${status}`,
    runtime: {
      environment:
        process.env.NODE_ENV === "production" ? "production" : "development",
      node: process.version,
      platform: process.platform,
    },
    fields: fields.filter(
      (field) =>
        typeof field === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(field),
    ),
  };
  (severity === "INFO"
    ? console.info
    : severity === "WARNING"
      ? console.warn
      : console.error)(JSON.stringify(entry));
  return entry;
}
