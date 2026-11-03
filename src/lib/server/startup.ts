import "server-only";
import {
  validateAuthEnvironment,
  validateDatabaseEnvironment,
  validateStorageEnvironment,
  validateSigningEnvironment,
  ConfigurationError,
} from "./runtime-config.mjs";
import { startupDiagnostic } from "./startup-diagnostics.mjs";
import { safeLog } from "./safe-log";
export async function validateStartup() {
  let config;
  try {
    config = validateAuthEnvironment();
    process.env.APP_ENV = config.APP_ENV;
    process.env.AUTH_URL = config.origin;
    process.env.NEXTAUTH_URL = config.origin;
    startupDiagnostic("authentication", "configured", "AUTH_CONFIG_VALID");
  } catch (error) {
    startupDiagnostic(
      "authentication",
      "failed",
      "AUTH_CONFIG_INVALID",
      "CRITICAL",
      error instanceof ConfigurationError ? error.fields : [],
    );
    safeLog("startup_failed", "AUTH_CONFIG_INVALID");
    throw error instanceof ConfigurationError
      ? error
      : new Error("Authentication configuration unavailable");
  }
  const checks = [
    ["google_sheets", validateDatabaseEnvironment, "DATABASE"],
    ["private_storage", validateStorageEnvironment, "STORAGE"],
    ["pdf_signing", validateSigningEnvironment, "SIGNING"],
  ] as const;
  for (const [component, validate, prefix] of checks) {
    try {
      const feature = validate();
      if (component === "pdf_signing" && !feature.signing)
        startupDiagnostic(component, "disabled", "SIGNING_DISABLED");
      else startupDiagnostic(component, "configured", `${prefix}_CONFIG_VALID`);
    } catch (error) {
      startupDiagnostic(
        component,
        "unavailable",
        `${prefix}_CONFIG_INVALID`,
        "WARNING",
        error instanceof ConfigurationError ? error.fields : [],
      );
    }
  }
  safeLog("startup_ready", "AUTH_READY_DEPENDENCIES_LAZY");
  return config;
}
