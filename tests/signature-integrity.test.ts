import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/server/storage", () => ({ getFile: m.get }));
import { verifySignatureFile } from "@/lib/server/signature-integrity";
afterEach(() => vi.clearAllMocks());
const data = Buffer.from("fixture"),
  id = crypto.randomUUID(),
  hash = createHash("sha256").update(data).digest("hex"),
  meta = [id, "owner", "", "at", id + ".png", hash];
it("verifies the exact private file hash", async () => {
  m.get.mockResolvedValue(data);
  await expect(verifySignatureFile(id, meta)).resolves.toBeUndefined();
  expect(m.get).toHaveBeenCalledWith(id + ".png");
});
it("rejects a missing file without treating it as an empty signature", async () => {
  m.get.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  await expect(verifySignatureFile(id, meta)).rejects.toMatchObject({
    errorCode: "STORAGE_SIGNATURE_MISSING",
    status: 503,
  });
});
it("rejects mismatched content and untrusted file names", async () => {
  m.get.mockResolvedValue(Buffer.from("wrong"));
  await expect(verifySignatureFile(id, meta)).rejects.toMatchObject({
    errorCode: "STORAGE_SIGNATURE_INTEGRITY",
  });
  m.get.mockClear();
  await expect(
    verifySignatureFile(id, [id, "owner", "", "at", "../other.png", hash]),
  ).rejects.toMatchObject({ errorCode: "STORAGE_SIGNATURE_INTEGRITY" });
  expect(m.get).not.toHaveBeenCalled();
});
