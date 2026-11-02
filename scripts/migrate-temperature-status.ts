// Owner-operated migration. Only supporting-sheet headers are created/extended.
import { ensureSheetHeaders, rows, sheetIds } from "../src/lib/server/sheets";
import { locked } from "../src/lib/server/storage";
async function main() {
  await locked(async () => {
    const ids = await sheetIds(),
      name = "TEMPERATURE_CORRECTIVE_ACTIONS";
    const before = ids[name] === undefined ? [] : (await rows(name)).slice(1);
    await ensureSheetHeaders([name, "TEMPERATURE_DEVICE_STATES"]);
    const after = (await rows(name)).slice(1);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error("Pemeriksaan migrasi gagal: data historis berubah");
    console.log(
      JSON.stringify({
        migration: "temperature-status-v1",
        historicalActions: after.length,
        historicalRowsPreserved: true,
        supportingSheetsReady: true,
      }),
    );
  });
}
main().catch(() => {
  console.error(
    "Migrasi belum berhasil. Periksa akses Google Sheets dan header; tidak ada penghapusan data.",
  );
  process.exitCode = 1;
});
