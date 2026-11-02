import { it, expect, vi, beforeEach } from "vitest";
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
beforeEach(() => vi.clearAllMocks());
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
  await expect(checkSheetsAccess()).rejects.toThrow("SHEETS_ACCESS_OR_SCHEMA");
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("PRIVATE_KEY");
  m.get.mockResolvedValue({ data: { valueRanges: [] } });
  await expect(checkSheetsAccess()).rejects.toThrow("SHEETS_ACCESS_OR_SCHEMA");
});
