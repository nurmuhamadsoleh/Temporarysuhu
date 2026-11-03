import { beforeEach, afterEach, it, expect, vi } from "vitest";
import path from "node:path";
const m = vi.hoisted(() => ({ read: vi.fn(), exec: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: m.read }));
vi.mock("node:child_process", () => ({ execFile: m.exec }));
import { signingAvailability } from "@/lib/server/signing-service";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PDF_SIGNING_ENABLED", "true");
  vi.stubEnv("PDF_SIGNING_P12_PATH", path.resolve("../signing-test/cert.p12"));
  vi.stubEnv("PDF_SIGNING_P12_PASSWORD", "DO-NOT-LOG-P12-PASSWORD");
  vi.stubEnv("PDF_SIGNING_CERTIFICATE_ENV", "production");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("keeps missing optional signing disabled without touching certificate or OpenSSL", async () => {
  vi.stubEnv("PDF_SIGNING_ENABLED", undefined);
  expect(await signingAvailability()).toMatchObject({
    available: false,
    status: "disabled",
  });
  expect(m.read).not.toHaveBeenCalled();
  expect(m.exec).not.toHaveBeenCalled();
});
it("classifies missing certificate as feature unavailable, not application fatal", async () => {
  m.read.mockRejectedValue(
    Object.assign(new Error("SECRET_CERTIFICATE_PATH"), { code: "ENOENT" }),
  );
  expect(await signingAvailability()).toMatchObject({
    available: false,
    status: "unavailable",
    errorCode: "CERTIFICATE_ENOENT",
  });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    "SECRET_CERTIFICATE_PATH",
  );
  expect(m.exec).not.toHaveBeenCalled();
});
it("does not advertise Mode B with an invalid P12 or password", async () => {
  m.read.mockResolvedValue(Buffer.from("DO-NOT-LOG-P12-BYTES"));
  expect(await signingAvailability()).toMatchObject({
    available: false,
    errorCode: "CERTIFICATE_INVALID",
  });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    "DO-NOT-LOG",
  );
});
