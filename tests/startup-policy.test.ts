import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  fs: vi.fn(),
  network: vi.fn(),
  certificate: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: m.fs,
  readFile: m.fs,
  writeFile: m.fs,
  unlink: m.fs,
  realpath: m.fs,
}));
vi.mock("@/lib/server/readiness", () => ({ checkSheetsAccess: m.network }));
vi.mock("@/lib/server/signing-service", () => ({
  loadSigningCertificate: m.certificate,
}));
import { validateStartup } from "@/lib/server/startup";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", undefined);
  vi.stubEnv("AUTH_URL", "https://temperatursuhu.bogarasatama.com");
  vi.stubEnv("NEXTAUTH_URL", "https://temperatursuhu.bogarasatama.com");
  vi.stubEnv("AUTH_SECRET", "safe-fixture-random-0123456789-ABCdef");
  vi.stubEnv("AUTH_GOOGLE_ID", "123-fixture.apps.googleusercontent.com");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "GOCSPX-fixture-test-secret");
  vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", "false");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function entries() {
  return [console.info, console.warn, console.error].flatMap((log) =>
    vi.mocked(log).mock.calls.map((call) => JSON.parse(String(call[0]))),
  );
}
it("boots with auth configuration while missing database/storage/signing cannot block Login", async () => {
  vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", undefined);
  vi.stubEnv("GOOGLE_PRIVATE_KEY", undefined);
  vi.stubEnv("GOOGLE_SPREADSHEET_ID", undefined);
  vi.stubEnv("PRIVATE_STORAGE_PATH", undefined);
  vi.stubEnv("PDF_SIGNING_ENABLED", undefined);
  expect((await validateStartup()).origin).toBe(
    "https://temperatursuhu.bogarasatama.com",
  );
  expect(m.fs).not.toHaveBeenCalled();
  expect(m.network).not.toHaveBeenCalled();
  expect(m.certificate).not.toHaveBeenCalled();
  expect(entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        component: "google_sheets",
        severity: "WARNING",
        errorCode: "DATABASE_CONFIG_INVALID",
      }),
      expect.objectContaining({ component: "pdf_signing", status: "disabled" }),
    ]),
  );
});
it("reports an explicit invalid legacy flag as fatal configuration without logging its value", async () => {
  vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", "NOT-VALID-DO-NOT-LOG");
  await expect(validateStartup()).rejects.toThrow("LEGACY_CREDENTIALS_ENABLED");
  expect(entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        component: "authentication",
        severity: "CRITICAL",
        fields: ["LEGACY_CREDENTIALS_ENABLED"],
      }),
    ]),
  );
  expect(JSON.stringify(entries())).not.toContain("NOT-VALID-DO-NOT-LOG");
});
it("leaves enabled but missing PDF configuration unavailable without reading a certificate", async () => {
  vi.stubEnv("PDF_SIGNING_ENABLED", "true");
  vi.stubEnv("PDF_SIGNING_P12_PATH", undefined);
  vi.stubEnv("PDF_SIGNING_P12_PASSWORD", undefined);
  await validateStartup();
  expect(entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        component: "pdf_signing",
        errorCode: "SIGNING_CONFIG_INVALID",
        severity: "WARNING",
      }),
    ]),
  );
  expect(m.fs).not.toHaveBeenCalled();
  expect(m.certificate).not.toHaveBeenCalled();
});
it("fails startup critically for missing AUTH_SECRET without allowing anonymous workspace", async () => {
  vi.stubEnv("AUTH_SECRET", undefined);
  await expect(validateStartup()).rejects.toThrow("AUTH_SECRET");
  expect(entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        component: "authentication",
        status: "failed",
        severity: "CRITICAL",
        fields: expect.arrayContaining(["AUTH_SECRET"]),
      }),
    ]),
  );
});
it("logs field names and fixed categories, not invalid credential values", async () => {
  vi.stubEnv("GOOGLE_PRIVATE_KEY", "DO-NOT-LOG-PRIVATE-KEY");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "invalid-test");
  await validateStartup();
  const output = JSON.stringify(entries());
  expect(output).not.toContain("DO-NOT-LOG");
  expect(output).not.toContain("GOCSPX-fixture");
  expect(output).not.toContain("safe-fixture-random");
  expect(entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: "startup_check",
        component: "google_sheets",
        category: "CONFIGURATION",
        runtime: expect.objectContaining({ environment: "production" }),
      }),
    ]),
  );
});
