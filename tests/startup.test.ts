import { it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
const m = vi.hoisted(() => ({
  config: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn(),
  unlink: vi.fn(),
  read: vi.fn(),
  check: vi.fn(),
  log: vi.fn(),
  certificate: vi.fn(),
}));
vi.mock("@/lib/server/runtime-config.mjs", () => ({
  validateRuntimeEnvironment: m.config,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: m.mkdir,
  writeFile: m.write,
  unlink: m.unlink,
  readFile: m.read,
  realpath: async (p: string) => path.resolve(p),
}));
vi.mock("@/lib/server/readiness", () => ({ checkSheetsAccess: m.check }));
vi.mock("@/lib/server/safe-log", () => ({ safeLog: m.log }));
vi.mock("@/lib/server/reports", () => ({ validateP12: m.certificate }));
import { validateStartup } from "@/lib/server/startup";
const config = () => ({
  production: true,
  origin: "https://temperatursuhu.bogarasatama.com",
  storage: path.resolve("..", "startup-test-shared"),
  signing: false,
  PDF_SIGNING_P12_PATH: "test-reference-only",
  PDF_SIGNING_P12_PASSWORD: "test-password",
  OPENSSL_PATH: "not-executed",
});
beforeEach(() => {
  vi.clearAllMocks();
  m.config.mockReturnValue(config());
  m.check.mockResolvedValue(true);
});
it("checks writable persistent storage and read-only Sheets before declaring ready", async () => {
  await validateStartup();
  expect(m.write).toHaveBeenCalledOnce();
  expect(m.unlink).toHaveBeenCalledOnce();
  expect(m.check).toHaveBeenCalledOnce();
  expect(m.log).toHaveBeenCalledWith("startup_ready", "READY");
});
it("refuses production storage inside a release even after path resolution", async () => {
  m.config.mockReturnValue({ ...config(), storage: process.cwd() });
  await expect(validateStartup()).rejects.toThrow("Startup tidak siap");
  expect(m.check).not.toHaveBeenCalled();
});
it("does not promote a self-signed certificate to production", async () => {
  m.config.mockReturnValue({ ...config(), signing: true });
  m.read.mockResolvedValue(Buffer.from("test-only"));
  m.certificate.mockReturnValue({ isIssuer: () => true });
  await expect(validateStartup()).rejects.toThrow("Startup tidak siap");
  expect(m.check).not.toHaveBeenCalled();
});
it("fails closed and logs safe codes when Sheets throws a secret-bearing error", async () => {
  m.check.mockRejectedValue(new Error("AUTH_SECRET=do-not-log"));
  await expect(validateStartup()).rejects.toThrow("Startup tidak siap");
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("do-not-log");
});
