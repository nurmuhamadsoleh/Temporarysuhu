import { it, expect, vi, beforeEach, afterEach } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/server/sheets", () => ({
  getSpreadsheetClient: () => ({
    spreadsheets: { values: { batchGet: m.get } },
  }),
  headers: {
    APP_USERS: ["USER ID", "GOOGLE ID"],
    "Suhu Chiller": ["RECORD ID"],
    "Suhu Freezer": ["RECORD ID"],
  },
}));
vi.mock("@/lib/server/safe-log", () => ({ safeLog: m.log }));
import { checkSheetsAccess } from "@/lib/server/readiness";
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("checks Sheets headers read-only without disclosing row content", async () => {
  m.get.mockResolvedValue({
    data: {
      valueRanges: [
        { values: [["USER ID", "GOOGLE ID"]] },
        { values: [["RECORD ID"]] },
        { values: [["RECORD ID"]] },
      ],
    },
  });
  expect(await checkSheetsAccess()).toBe(true);
  expect(m.get.mock.calls[0][0].valueRenderOption).toBe("UNFORMATTED_VALUE");
});
it("fails readiness on invalid schema or inaccessible spreadsheet and logs only safe codes", async () => {
  m.get.mockRejectedValue(new Error("PRIVATE_KEY=do-not-log"));
  await expect(checkSheetsAccess()).rejects.toMatchObject({
    status: 503,
    errorCode: "GOOGLE_SHEETS_UNAVAILABLE",
  });
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    "do-not-log",
  );
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("GOOGLE_SHEETS_UNAVAILABLE"),
  );
  m.get.mockResolvedValue({ data: { valueRanges: [] } });
  await expect(checkSheetsAccess()).rejects.toMatchObject({
    status: 503,
    errorCode: "GOOGLE_SHEETS_SCHEMA_MISMATCH",
  });
});
