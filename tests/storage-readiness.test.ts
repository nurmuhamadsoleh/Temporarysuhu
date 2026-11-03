import { beforeEach, afterEach, it, expect, vi } from "vitest";
import path from "node:path";
const m = vi.hoisted(() => ({
  mkdir: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  realpath: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: m.mkdir,
  readFile: m.read,
  writeFile: m.write,
  realpath: m.realpath,
  unlink: m.unlink,
  rename: vi.fn(),
}));
import { checkPrivateStorage } from "@/lib/server/storage";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "PRIVATE_STORAGE_PATH",
    path.resolve("../persistent-storage-fixture"),
  );
  vi.stubEnv("SIGNATURE_STORAGE_PROVIDER", "local");
  vi.stubEnv("AUTH_COORDINATION_MODE", "single-host");
  vi.stubEnv("STORAGE_PERSISTENCE_CONFIRMED", "true");
  m.mkdir.mockResolvedValue(undefined);
  m.realpath.mockImplementation(async (p: string) => p);
  m.unlink.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["EACCES", "EROFS", "ENOSPC"])(
  "reports %s without declaring a successful storage write",
  async (code) => {
    m.write.mockRejectedValue(
      Object.assign(new Error("DO-NOT-LOG-PATH"), { code }),
    );
    await expect(checkPrivateStorage()).rejects.toMatchObject({
      status: 503,
      errorCode: `STORAGE_${code}`,
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "DO-NOT-LOG",
    );
    expect(m.unlink).toHaveBeenCalledTimes(1);
  },
);
it("rejects an external path that resolves through a symlink into the release", async () => {
  m.realpath.mockResolvedValue(process.cwd());
  await expect(checkPrivateStorage()).rejects.toMatchObject({
    status: 503,
    errorCode: "STORAGE_CONFIG_INVALID",
  });
  expect(m.write).not.toHaveBeenCalled();
});
