import { ZodError } from "zod";
import { AppError, fail } from "./errors";
export type SaveStage =
  | "authentication"
  | "validation"
  | "storage"
  | "sheets_read"
  | "sheets_write"
  | "verification";
export type SaveProgress = (stage: SaveStage) => void;
export function saveReason(error: unknown) {
  const code = (error as { errorCode?: unknown })?.errorCode;
  if (
    typeof code === "string" &&
    /^(STORAGE|GOOGLE|SIGNATURE|TEMPERATURE)_[A-Z0-9_]{1,56}$/.test(code)
  )
    return code;
  if (error instanceof ZodError) return "VALIDATION_FAILED";
  if (error instanceof AppError)
    return error.status === 401
      ? "SESSION_EXPIRED"
      : error.status === 403
        ? "PERMISSION_DENIED"
        : error.status === 409
          ? "SAVE_CONFLICT"
          : error.status < 500
            ? "VALIDATION_FAILED"
            : "DEPENDENCY_UNAVAILABLE";
  return "INTERNAL";
}
export function temperatureSave(
  operation: "create" | "update" | "signature",
  deviceType: string,
) {
  const requestId = crypto.randomUUID();
  const type = ["chiller", "freezer"].includes(deviceType)
    ? deviceType
    : "unknown";
  let stage: SaveStage = "authentication";
  const log = (event: string, status: number, errorCode?: string) => {
    const category = errorCode?.startsWith("STORAGE_")
      ? "storage"
      : errorCode?.startsWith("GOOGLE_")
        ? "google_sheets"
        : stage;
    (event.endsWith("FAILED") ? console.error : console.info)(
      JSON.stringify({
        at: new Date().toISOString(),
        event,
        requestId,
        operation,
        deviceType: type,
        stage,
        category,
        httpStatus: status,
        ...(errorCode ? { errorCode } : {}),
      }),
    );
  };
  log("TEMPERATURE_SAVE_STARTED", 0);
  const progress: SaveProgress = (next) => {
    stage = next;
    if (next === "storage") log("TEMPERATURE_SAVE_STORAGE_CHECK", 0);
    if (next === "sheets_read") log("TEMPERATURE_SAVE_VALIDATED", 0);
    if (next === "sheets_write") log("TEMPERATURE_SAVE_SHEETS_WRITE", 0);
  };
  return {
    requestId,
    progress,
    complete(response: Response) {
      log("TEMPERATURE_SAVE_COMPLETED", response.status);
      response.headers.set("X-Request-ID", requestId);
      return response;
    },
    failed(error: unknown) {
      const response = fail(error, {
        requestId,
        stage,
        reason: saveReason(error),
      });
      log("TEMPERATURE_SAVE_FAILED", response.status, saveReason(error));
      return response;
    },
  };
}
