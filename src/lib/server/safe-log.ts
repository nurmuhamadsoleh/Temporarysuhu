type Event =
  | "startup_ready"
  | "startup_failed"
  | "sheets_check_failed"
  | "request_failed"
  | "auth_error"
  | "report_identity_fallback"
  | "auth_warning";
/** Never serialize Error objects, request URLs, headers, body, OAuth tokens or env values. */
export function safeLog(
  event: Event,
  code: string | number = "INTERNAL",
  requestId?: string,
) {
  const safeCode =
    String(code)
      .replace(/[^A-Z0-9_]/gi, "")
      .slice(0, 60) || "INTERNAL";
  const log = event === "startup_ready" ? console.info : console.error;
  log(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      code: safeCode,
      ...(requestId ? { requestId } : {}),
    }),
  );
}
