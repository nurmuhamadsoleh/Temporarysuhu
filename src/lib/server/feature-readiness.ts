import "server-only";
import {
  validateAuthEnvironment,
  ConfigurationError,
} from "./runtime-config.mjs";
import { checkSheetsAccess } from "./readiness";
import { checkPrivateStorage } from "./storage";
import { signingAvailability } from "./signing-service";
import { FeatureUnavailable } from "./dependency-failure";
import { startupDiagnostic } from "./startup-diagnostics.mjs";

type ComponentState = {
  status: "ready" | "disabled" | "unavailable";
  errorCode: string;
  fields?: string[];
};
export async function featureReadiness() {
  const components: Record<string, ComponentState> = {};
  try {
    validateAuthEnvironment();
    components.authentication = {
      status: "ready",
      errorCode: "AUTH_CONFIG_VALID",
    };
  } catch (error) {
    components.authentication = {
      status: "unavailable",
      errorCode: "AUTH_CONFIG_INVALID",
      fields: error instanceof ConfigurationError ? error.fields : [],
    };
  }
  try {
    await checkPrivateStorage();
    components.private_storage = {
      status: "ready",
      errorCode: "STORAGE_READY",
    };
  } catch (error) {
    components.private_storage = {
      status: "unavailable",
      errorCode:
        error instanceof FeatureUnavailable
          ? error.errorCode
          : "STORAGE_UNAVAILABLE",
      fields: error instanceof FeatureUnavailable ? error.fields : [],
    };
  }
  try {
    await checkSheetsAccess();
    components.google_sheets = {
      status: "ready",
      errorCode: "GOOGLE_SHEETS_READY",
    };
  } catch (error) {
    components.google_sheets = {
      status: "unavailable",
      errorCode:
        error instanceof FeatureUnavailable
          ? error.errorCode
          : "GOOGLE_SHEETS_UNAVAILABLE",
      fields: error instanceof FeatureUnavailable ? error.fields : [],
    };
  }
  const signing = await signingAvailability();
  components.pdf_signing = {
    status: signing.available
      ? "ready"
      : signing.status === "disabled"
        ? "disabled"
        : "unavailable",
    errorCode: signing.errorCode,
  };
  const ready = ["authentication", "private_storage", "google_sheets"].every(
    (name) => components[name].status === "ready",
  );
  for (const [component, state] of Object.entries(components))
    if (state.status === "ready" || state.status === "disabled")
      startupDiagnostic(component, state.status, state.errorCode);
  return {
    service: "tempcontrol",
    status: ready ? "ready" : "degraded",
    components,
  };
}
