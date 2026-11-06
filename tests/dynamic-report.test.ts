import { it, expect, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { fixtureRecord, fixtureReport } from "./control-fixtures";
import {
  DEFAULT_TEMPERATURE_POLICY,
  getTemperatureStatus,
  emptyDeviceInput,
} from "@/lib/temperature-policy";
import { defaultDeviceId } from "@/lib/devices";
import { makeControlPages } from "@/lib/temperature-report/model";
import { buildControlScenes } from "@/lib/temperature-report/scene";
vi.mock("@/lib/server/storage", () => ({ getFile: vi.fn() }));
import { generateTemperatureControlPdf } from "@/lib/server/control-pdf";
it("generates a nonempty vector line-chart report for device 7 with the correct values, identity and action", async () => {
  const id = crypto.randomUUID(),
    values = [-13.5, -9.9, -7.9],
    records = values.map((temperature, index) => {
      const record = fixtureRecord("freezer", {
        time: ["03:00", "07:00", "11:00"][index],
        values: [-15.5, temperature],
        deviceRefs: [
          { id: defaultDeviceId("freezer", 1), number: 1 },
          { id, number: 7 },
        ],
        policy: DEFAULT_TEMPERATURE_POLICY,
        policyVersion: DEFAULT_TEMPERATURE_POLICY.version,
        officer: "DATA UJI Petugas Lengkap",
      });
      record.deviceStates = record.values.map((value, i) => ({
        ...emptyDeviceInput(),
        deviceNumber: i === 0 ? 1 : 7,
        deviceId: i === 0 ? defaultDeviceId("freezer", 1) : id,
        temperatureStatus: getTemperatureStatus(
          "freezer",
          value,
          DEFAULT_TEMPERATURE_POLICY,
        ).code,
      }));
      return record;
    });
  const report = {
    ...fixtureReport("freezer", 7, records),
    sop: { min: -18, max: -10 },
  };
  report.filter = { ...report.filter, from: "2026-11-10", to: "2026-11-10" };
  report.pages = makeControlPages(
    report.readings,
    report.filter,
    report.settings,
  );
  report.corrections = [
    {
      id: crypto.randomUUID(),
      recordId: records[2].id,
      deviceType: "freezer",
      deviceNumber: 7,
      date: records[2].date,
      time: records[2].time,
      description:
        "DATA UJI: pemeriksaan perangkat tambahan; bukan catatan operasional.",
      performedBy: "fixture-actor",
      performedByName: "DATA UJI Pelaksana",
      verificationStatus: "PENDING",
      actionStatus: "PERBAIKAN",
      verifiedBy: "",
      verifiedByName: "",
      verifiedAt: "",
      createdAt: records[2].createdAt,
      updatedAt: records[2].updatedAt,
    },
  ];
  expect(report.readings.map((r) => r.temperatureCelsius)).toEqual(values);
  expect(
    report.readings.every((r) => r.deviceNumber === 7 && r.deviceId === id),
  ).toBe(true);
  const commands = buildControlScenes(report).flatMap((p) => p.commands);
  expect(
    commands.some(
      (c) => c.kind === "text" && c.text.includes("Perangkat: Freezer 7"),
    ),
  ).toBe(true);
  expect(
    commands.filter((c) => c.kind === "circle" && c.readingIds?.length),
  ).toHaveLength(3);
  expect(
    commands.filter((c) => c.kind === "line" && c.color === "#2563EB").length,
  ).toBeGreaterThanOrEqual(2);
  const pdf = await generateTemperatureControlPdf(report);
  expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
  expect(pdf.length).toBeGreaterThan(1000);
  if (process.env.DYNAMIC_PDF_QA_OUTPUT) {
    await mkdir(path.dirname(process.env.DYNAMIC_PDF_QA_OUTPUT), {
      recursive: true,
    });
    await writeFile(process.env.DYNAMIC_PDF_QA_OUTPUT, pdf);
  }
});
