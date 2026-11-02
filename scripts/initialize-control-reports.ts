import { ensureSheetHeaders, rows, headers } from "../src/lib/server/sheets";
import { locked } from "../src/lib/server/storage";
const names = [
  "TEMPERATURE_REPORT_CONFIG",
  "TEMPERATURE_REPORT_VERIFICATIONS",
  "TEMPERATURE_CORRECTIVE_ACTIONS",
];
async function main() {
  const expected = process.argv
    .find((v) => v.startsWith("--expected-spreadsheet="))
    ?.split("=")[1];
  if (!expected || process.env.GOOGLE_SPREADSHEET_ID !== expected)
    throw new Error("Spreadsheet tujuan tidak cocok; inisialisasi dibatalkan");
  await locked(async () => {
    await ensureSheetHeaders(names);
    for (const name of names) {
      const first = (await rows(name))[0];
      if (JSON.stringify(first) !== JSON.stringify(headers[name]))
        throw new Error(`Header ${name} belum terverifikasi`);
    }
  });
  console.log(
    "Tiga header pendukung laporan berhasil diinisialisasi dan dibaca ulang.",
  );
}
main().catch(() => {
  console.error(
    "Inisialisasi belum berhasil. Periksa ID spreadsheet, header dan izin service account; rahasia tidak dicetak.",
  );
  process.exitCode = 1;
});
