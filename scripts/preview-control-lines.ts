// Offline QA fixtures only: no Google Sheets reads/writes or operational approval.
import { mkdir, writeFile } from "node:fs/promises";
import { fixtureRecord, fixtureReport } from "../tests/control-fixtures";
import { makeControlPages } from "../src/lib/temperature-report/model";
import {
  DEFAULT_TEMPERATURE_POLICY,
  emptyDeviceInput,
  getTemperatureStatus,
} from "../src/lib/temperature-policy";
import { buildTemperatureReportData } from "../src/lib/server/report-data";
import { generateTemperatureControlPdf } from "../src/lib/server/control-pdf";
const fullNamesQA = process.argv.includes("--full-names");
async function main() {
  await mkdir("output/pdf", { recursive: true });
  for (const kind of ["chiller", "freezer"] as const) {
    const samples: [string, string, number | null][] = [
      ["2026-11-10", "03:00", kind === "chiller" ? 2 : -20.7],
      ["2026-11-10", "07:00", kind === "chiller" ? 1.8 : -19.8],
      ["2026-11-10", "11:00", null],
      ["2026-11-10", "15:00", kind === "chiller" ? 4.7 : -18.5],
      ["2026-11-10", "19:00", kind === "chiller" ? 5.1 : -17.3],
      ["2026-11-10", "19:23", kind === "chiller" ? 3.8 : -18.1],
      ["2026-11-10", "23:00", kind === "chiller" ? -0.1 : -20.1],
      ["2026-11-11", "03:00", kind === "chiller" ? 2.3 : -19.1],
      ["2026-11-11", "07:00", kind === "chiller" ? 2.3 : -19.1],
      ["2026-11-11", "07:00", kind === "chiller" ? 2.3 : -19.1],
      ["2026-11-11", "11:00", kind === "chiller" ? 2.8 : -18.5],
      ["2026-11-11", "15:00", kind === "chiller" ? 3 : -19],
    ];
    const records = samples
      .map(([date, time, value]) =>
        fixtureRecord(kind, {
          date,
          time,
          ...(fullNamesQA
            ? { createdBy: time === "11:00" ? "test-second" : "test-operator" }
            : {}),
          values: Array(kind === "chiller" ? 5 : 4).fill(value),
          policy: DEFAULT_TEMPERATURE_POLICY,
          policyVersion: DEFAULT_TEMPERATURE_POLICY.version,
          deviceStates: Array.from(
            { length: kind === "chiller" ? 5 : 4 },
            (_, i) => ({
              ...emptyDeviceInput(),
              deviceNumber: i + 1,
              temperatureStatus: getTemperatureStatus(
                kind,
                value,
                DEFAULT_TEMPERATURE_POLICY,
              ).code,
              missingReason:
                value === null ? "DATA UJI: pengukuran belum dilakukan" : "",
            }),
          ),
        }),
      )
      .reverse();
    const report = fixtureReport(kind, 1, records);
    report.filter.from = "2026-11-10";
    report.filter.to = "2026-11-11";
    report.sop = DEFAULT_TEMPERATURE_POLICY[kind];
    report.pages = makeControlPages(
      report.readings,
      report.filter,
      report.settings,
    );
    const source = report.readings.find((r) => r.time === "19:00")!;
    report.corrections = [
      {
        id: crypto.randomUUID(),
        recordId: source.recordId,
        deviceType: kind,
        deviceNumber: 1,
        date: source.date,
        time: source.time,
        description:
          "DATA UJI: contoh catatan untuk memeriksa format tabel; bukan tindakan operasional.",
        performedBy: "test-operator",
        performedByName: "Teknisi Data Uji",
        performerIsManual: true,
        actionStatus: "PERBAIKAN",
        verificationStatus: "PENDING",
        verifiedBy: "",
        verifiedByName: "",
        verifiedAt: "",
        createdAt: report.createdAt,
        updatedAt: report.createdAt,
      },
    ];
    await writeFile(
      `output/pdf/${fullNamesQA ? "tempcontrol-full-names" : "tempcontrol-line-chart"}-${kind}.pdf`,
      await generateTemperatureControlPdf(
        await buildTemperatureReportData(report, [
          {
            id: "test-operator",
            name: fullNamesQA
              ? "Petugas Pengukuran Data Uji Pertama"
              : "Petugas Data Uji",
          },
          { id: "test-second", name: "Petugas Pengukuran Data Uji Kedua" },
        ]),
      ),
    );
    console.log(`Offline ${kind} line-chart PDF ready`);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
