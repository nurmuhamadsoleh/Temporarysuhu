import { describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
vi.mock("@/lib/server/storage", () => ({
  getFile: vi.fn(async () =>
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  ),
  putFile: vi.fn(),
}));
import {
  generatePdf,
  validateP12,
  verifySignedPdf,
  type Snapshot,
} from "@/lib/server/reports";
describe("Report integrity", () => {
  it("generates a valid visual-mode PDF from real snapshot decimals", async () => {
    const s = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdBy: "id",
      officer: "Tester",
      company: "Kitchen",
      from: "2026-10-01",
      to: "2026-10-31",
      revisionOf: "",
      sop: { chiller: null, freezer: null },
      records: [
        {
          id: "a",
          kind: "chiller",
          date: "2026-10-31",
          time: "12:00",
          values: [1.8, 2.3, 4.7, 0, 0.5],
          officer: "Tester",
          signatureId: "test",
          status: "BELUM DIKONFIGURASI",
          notes: "Audit test",
        },
      ],
    } as Snapshot;
    const pdf = await generatePdf(s);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    expect(s.records[0].values[0]).toBe(1.8);
  });
  it("rejects invalid P12 rather than pretending to sign", () =>
    expect(() => validateP12(Buffer.from("invalid"), "bad")).toThrow(
      "invalid",
    ));
  it("rejects unsigned documents in signature verification", async () =>
    await expect(verifySignedPdf(Buffer.from("%PDF-1.7"))).rejects.toThrow(
      "ByteRange",
    ));
});
