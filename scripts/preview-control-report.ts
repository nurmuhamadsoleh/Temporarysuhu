import {
  DEFAULT_TEMPERATURE_POLICY,
  getTemperatureStatus,
  emptyDeviceInput,
} from "../src/lib/temperature-policy";
// Offline layout fixture only. Does not read or write Google Sheets.
import { mkdir, writeFile } from "node:fs/promises";
import { buildTemperatureReportData } from "../src/lib/server/report-data";
import { generateControlPdf } from "../src/lib/server/control-pdf";
import { fixtureRecord, fixtureReport } from "../tests/control-fixtures";
const records = [
  fixtureRecord("chiller", { date: "2026-11-09", time: "03:00" }),
  fixtureRecord("chiller", {
    date: "2026-11-09",
    time: "07:00",
    values: [0.5, 2, 4, 6, 8],
  }),
  ...Array.from({ length: 4 }, () => fixtureRecord()),
  fixtureRecord("chiller", {
    date: "2026-11-11",
    time: "03:00",
    values: [4.7, 2, 4, 6, 8],
  }),
  fixtureRecord("chiller", {
    date: "2026-11-12",
    time: "07:23",
    values: [2.3, 2, 4, 6, 8],
  }),
];
records.push(
  ...[4.1, 5.1, -0.1, null].map((v, i) =>
    fixtureRecord("chiller", {
      date: "2026-11-12",
      time: ["11:00", "15:00", "19:00", "23:00"][i],
      values: [v, 2, 4, 6, 8],
    }),
  ),
);
const report = fixtureReport(
  "chiller",
  1,
  records.map((r) => ({
    ...r,
    policy: DEFAULT_TEMPERATURE_POLICY,
    policyVersion: DEFAULT_TEMPERATURE_POLICY.version,
    deviceStates: r.values.map((v, i) => ({
      ...emptyDeviceInput(),
      deviceNumber: i + 1,
      temperatureStatus: getTemperatureStatus(
        "chiller",
        v,
        DEFAULT_TEMPERATURE_POLICY,
      ).code,
      missingReason: v === null ? "DATA UJI: perangkat belum dapat diukur" : "",
    })),
  })),
);
report.corrections = Array.from({ length: 10 }, (_, i) => {
  const reading = report.readings[i % report.readings.length];
  return {
    id: crypto.randomUUID(),
    recordId: reading.recordId,
    deviceType: "chiller",
    deviceNumber: 1,
    date: reading.date,
    time: reading.time,
    description:
      "DATA UJI - Tindakan " +
      (i + 1) +
      " (bukan catatan operasional).\n" +
      (i === 9
        ? Array.from(
            { length: 60 },
            (_, j) => "Rincian pemeriksaan uji baris " + (j + 1),
          ).join("\n")
        : "Simulasi isi tabel tindakan untuk pemeriksaan format PDF."),
    performedBy: "test-operator",
    performedByName: "Teknisi Data Uji",
    performerIsManual: true,
    actionStatus: (["PENDING", "PERBAIKAN", "SELESAI"] as const)[i % 3],
    verificationStatus: "PENDING",
    verifiedBy: "",
    verifiedByName: "",
    verifiedAt: "",
    createdAt: report.createdAt,
    updatedAt: report.createdAt,
  };
});
async function main() {
  await mkdir("output/pdf", { recursive: true });
  await writeFile(
    "output/pdf/tempcontrol-control-sheet-preview.pdf",
    await generateControlPdf(
      await buildTemperatureReportData(report, [
        { id: "test-operator", name: "Nur Muhamad Soleh" },
      ]),
    ),
  );
  console.log(
    "Offline preview: output/pdf/tempcontrol-control-sheet-preview.pdf",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
