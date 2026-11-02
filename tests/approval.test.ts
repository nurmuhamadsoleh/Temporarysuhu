import { it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({
  rows: vi.fn(),
  batch: vi.fn(),
  all: vi.fn(),
  getFile: vi.fn(),
}));
vi.mock("@/lib/server/sheets", () => ({
  rows: m.rows,
  batch: m.batch,
  allRecords: m.all,
  ensureSheetHeaders: async () => ({
    REPORTS: 1,
    SIGNATURE_METADATA: 2,
    AUDIT_LOG: 3,
  }),
  append: vi.fn(),
  replace: (sheetId: number, index: number, row: unknown[]) => ({
    sheetId,
    index,
    row,
  }),
  audit: () => ({ audit: true }),
  getSop: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  getFile: m.getFile,
  putFile: vi.fn(),
}));
import { approveReport } from "@/lib/server/reports";
const actor = {
  id: "supervisor",
  name: "Supervisor",
  email: "s@example.test",
  role: "SUPERVISOR" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.rows.mockImplementation(async (name: string) =>
    name === "REPORTS"
      ? [[], ["report", "now", "owner", "report.json", "DRAFT"]]
      : [[], ["signature", actor.id, "", "now", "signature.png", "hash"]],
  );
  m.getFile.mockResolvedValue(
    Buffer.from(
      JSON.stringify({ records: [{ id: "record", updatedAt: "version" }] }),
    ),
  );
  m.all.mockResolvedValue([{ id: "record", updatedAt: "version" }]);
});
it("approves only unchanged snapshots and atomically links examiner signature and audit", async () => {
  const row = await approveReport("report", actor, "signature");
  expect(row[4]).toBe("APPROVED");
  expect(row[10]).toBe("signature");
  expect(m.batch).toHaveBeenCalledOnce();
  expect(m.batch.mock.calls[0][0]).toHaveLength(3);
});
it("rejects stale snapshots and foreign/missing examiner signatures", async () => {
  m.all.mockResolvedValue([{ id: "record", updatedAt: "new-version" }]);
  await expect(
    approveReport("report", actor, "signature"),
  ).rejects.toMatchObject({ status: 409 });
  m.all.mockResolvedValue([{ id: "record", updatedAt: "version" }]);
  await expect(
    approveReport("report", actor, "foreign-signature"),
  ).rejects.toMatchObject({ status: 400 });
  expect(m.batch).not.toHaveBeenCalled();
});
