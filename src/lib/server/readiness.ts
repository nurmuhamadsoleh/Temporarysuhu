import "server-only";
import { getSpreadsheetClient, headers } from "./sheets";
import { safeLog } from "./safe-log";
export async function checkSheetsAccess() {
  try {
    const result = await getSpreadsheetClient().spreadsheets.values.batchGet(
      {
        spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID!,
        ranges: Object.keys(headers).map((name) => `'${name}'!A1:AZ1`),
        valueRenderOption: "UNFORMATTED_VALUE",
      },
      { timeout: 15000, retry: false },
    );
    const tables = result.data.valueRanges || [];
    for (const [i, [name, expected]] of Object.entries(headers).entries()) {
      const row = tables[i]?.values?.[0] || [];
      if (expected.some((v, j) => row[j] !== v))
        throw new Error(
          `SHEETS_SCHEMA_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
        );
    }
    return true;
  } catch (error) {
    const schema =
      error instanceof Error && /^SHEETS_SCHEMA_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : undefined;
    safeLog("sheets_check_failed", schema || "SHEETS_ACCESS_OR_SCHEMA");
    throw new Error("SHEETS_ACCESS_OR_SCHEMA");
  }
}
let cache: { at: number; ok: boolean } | undefined;
let pending: Promise<boolean> | undefined;
export async function readiness() {
  if (cache && Date.now() - cache.at < 30000) return cache.ok;
  if (pending) return pending;
  pending = checkSheetsAccess()
    .then(
      () => true,
      () => false,
    )
    .then((ok) => {
      cache = { at: Date.now(), ok };
      return ok;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
