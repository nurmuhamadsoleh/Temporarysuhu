import { it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { fixtureReport } from "./control-fixtures";
import { AppError } from "@/lib/server/errors";
const m = vi.hoisted(() => ({
  report: vi.fn(),
  pdf: vi.fn(),
  file: vi.fn(),
  put: vi.fn(),
  fresh: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireActor: async () => ({ id: "actor", role: "SUPERVISOR" }),
}));
vi.mock("@/lib/server/reports", () => ({
  report: m.report,
  generatePdf: m.pdf,
}));
vi.mock("@/lib/server/storage", () => ({
  getFile: m.file,
  putFile: m.put,
  locked: async (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/server/control-records", () => ({ checkControlFresh: m.fresh }));
import { GET } from "@/app/api/reports/[id]/download/route";
const id = "11111111-1111-4111-8111-111111111111",
  ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.fresh.mockResolvedValue({ fresh: true, verification: null });
  m.report.mockResolvedValue({
    snapshot: { control: fixtureReport() },
    row: [id, "now", "actor", "snapshot.json", "DRAFT"],
  });
  m.pdf.mockResolvedValue(Buffer.from("%PDF fixture"));
});
it("downloads a PDF privately and archives the rendered bytes under a content hash", async () => {
  const response = await GET(
    new Request(`http://localhost:3000/api/reports/${id}/download?download=1`),
    ctx,
  );
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
    "%PDF fixture",
  );
  expect(m.put).toHaveBeenCalledOnce();
});
it("never regenerates or modifies signed bytes when operational verification becomes invalid", async () => {
  const signed = Buffer.from("%PDF signed immutable fixture"),
    hash = createHash("sha256").update(signed).digest("hex");
  m.report.mockResolvedValue({
    snapshot: { control: fixtureReport() },
    row: [
      id,
      "now",
      "actor",
      "snapshot.json",
      "SIGNED",
      "Supervisor",
      "at",
      "signed.pdf",
      hash,
    ],
  });
  m.file.mockResolvedValue(signed);
  m.fresh.mockResolvedValue({
    fresh: false,
    verification: { status: "INVALIDATED" },
  });
  const response = await GET(
    new Request(`http://localhost:3000/api/reports/${id}/download`),
    ctx,
  );
  expect(response.headers.get("x-temperature-verification")).toBe(
    "INVALIDATED",
  );
  expect(Buffer.from(await response.arrayBuffer())).toEqual(signed);
  expect(m.pdf).not.toHaveBeenCalled();
  expect(m.put).not.toHaveBeenCalled();
});
it("returns storage/Sheets errors as failures instead of a fake successful PDF", async () => {
  m.fresh.mockRejectedValue(new AppError(503, "Google Sheets tidak tersedia"));
  const response = await GET(
    new Request(`http://localhost:3000/api/reports/${id}/download`),
    ctx,
  );
  expect(response.status).toBe(503);
  expect(m.pdf).not.toHaveBeenCalled();
});
it("serves identical PDF bytes for inline preview and attachment download", async () => {
  const preview = await GET(
    new Request(`http://localhost:3000/api/reports/${id}/download`),
    ctx,
  );
  const download = await GET(
    new Request(`http://localhost:3000/api/reports/${id}/download?download=1`),
    ctx,
  );
  expect(preview.headers.get("content-disposition")).toContain("inline");
  expect(download.headers.get("content-disposition")).toContain("attachment");
  expect(Buffer.from(await preview.arrayBuffer())).toEqual(
    Buffer.from(await download.arrayBuffer()),
  );
});
