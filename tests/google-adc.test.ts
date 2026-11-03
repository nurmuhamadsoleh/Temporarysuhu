import { afterEach, it, expect, vi } from "vitest";
import { google } from "googleapis";
import { getSpreadsheetClient } from "@/lib/server/sheets";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("constructs explicit ADC lazily without requesting a service-account private key or network access", () => {
  vi.stubEnv("GOOGLE_AUTH_MODE", "adc");
  vi.stubEnv("GOOGLE_SPREADSHEET_ID", "test-spreadsheet-12345678");
  vi.stubEnv("GOOGLE_PRIVATE_KEY", undefined);
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", undefined);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
  const fetch = vi.spyOn(globalThis, "fetch");
  const client = getSpreadsheetClient();
  expect(client.context._options.auth).toBeInstanceOf(google.auth.GoogleAuth);
  expect(fetch).not.toHaveBeenCalled();
});
