import { it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  fixtureFilter,
  fixtureRecord,
  fixtureReport,
} from "./control-fixtures";
import {
  controlFilterSchema,
  reportDates,
  normalizeReadings,
  makeControlPages,
  defaultReportConfig,
  temperatureY,
} from "@/lib/temperature-report/model";
import { buildControlScenes } from "@/lib/temperature-report/scene";
vi.mock("@/lib/server/storage", () => ({
  getFile: vi.fn(async () => {
    throw Object.assign(new Error("Missing"), { code: "ENOENT" });
  }),
}));
import { generateControlPdf } from "@/lib/server/control-pdf";
import { getFile } from "@/lib/server/storage";
it.each([
  ["chiller", 1, 1.8],
  ["chiller", 5, 0.5],
  ["freezer", 1, -18.5],
  ["freezer", 4, -19.8],
] as const)("isolates %s %s including decimals", (kind, index, value) => {
  const readings = normalizeReadings(
    [fixtureRecord(kind)],
    fixtureFilter(kind, index),
    { chiller: { min: 0, max: 4 }, freezer: { min: -22, max: -18 } },
  );
  expect(readings).toHaveLength(1);
  expect(readings[0].temperatureCelsius).toBe(value);
  expect(readings[0].deviceNumber).toBe(index);
});
it.each([
  [2026, 2, 28],
  [2028, 2, 29],
  [2026, 4, 30],
  [2026, 11, 30],
  [2026, 12, 31],
])("keeps actual calendar days %s-%s", (year, month, length) =>
  expect(reportDates({ ...fixtureFilter(), year, month })).toHaveLength(length),
);
it("rejects invalid device numbers, invalid dates and cross-month filters", () => {
  expect(
    controlFilterSchema.safeParse({ ...fixtureFilter("freezer", 5) }).success,
  ).toBe(false);
  expect(
    controlFilterSchema.safeParse({ ...fixtureFilter(), from: "2026-11-31" })
      .success,
  ).toBe(false);
  expect(
    controlFilterSchema.safeParse({ ...fixtureFilter(), to: "2026-12-01" })
      .success,
  ).toBe(false);
});
it("uses continuous Celsius coordinates rather than rounded marks", () => {
  expect(temperatureY(1.8, "chiller")).toBeCloseTo((14 - 1.8) / 16);
  expect(temperatureY(-18.5, "freezer")).toBeCloseTo((-6 + 18.5) / 16);
  const report = fixtureReport();
  expect(report.pages.flatMap((p) => p.points)[0].temperatureCelsius).toBe(1.8);
});
it("retains every duplicate, off-schedule reading and real midnight date", () => {
  const f = { ...fixtureFilter(), from: "2026-11-10", to: "2026-11-11" };
  const records = [
    ...Array.from({ length: 5 }, () => fixtureRecord()),
    fixtureRecord("chiller", { time: "07:23" }),
    fixtureRecord("chiller", { date: "2026-11-11", time: "03:00" }),
  ];
  const readings = normalizeReadings(records, f, {
    chiller: null,
    freezer: null,
  });
  const pages = makeControlPages(readings, f, {
    ...defaultReportConfig,
    schedule: ["07:00", "11:00", "15:00", "19:00", "23:00", "03:00"],
  });
  expect(
    pages.flatMap((p) => p.points).flatMap((p) => p.readingIds),
  ).toHaveLength(7);
  expect(pages.flatMap((p) => p.points).some((p) => p.count === 5)).toBe(true);
  expect(
    pages
      .flatMap((p) => p.columns)
      .some((c) => c.time === "07:23" && !c.scheduled),
  ).toBe(true);
  expect(readings.at(-1)?.timestamp).toBe("2026-11-11T03:00:00+07:00");
  expect(
    pages
      .flatMap((p) => p.columns)
      .find((c) => c.readingIds.includes(records.at(-1)!.id))?.date,
  ).toBe("2026-11-11");
});
it("refuses ambiguous duplicate RECORD IDs", () => {
  const r = fixtureRecord();
  expect(() =>
    normalizeReadings([r, r], fixtureFilter(), {
      chiller: null,
      freezer: null,
    }),
  ).toThrow("duplikat");
});
it("normalizes Indonesian dates and Sheets date/time serials without a calendar shift", () => {
  const serial = (Date.UTC(2026, 10, 10) - Date.UTC(1899, 11, 30)) / 86400000;
  const a = fixtureRecord("chiller", { date: "10/11/2026", time: "7:00" }),
    b = fixtureRecord("chiller", {
      date: String(serial),
      time: String(7 / 24),
    });
  const readings = normalizeReadings([a, b], fixtureFilter(), {
    chiller: null,
    freezer: null,
  });
  expect(
    readings.every((r) => r.timestamp === "2026-11-10T07:00:00+07:00"),
  ).toBe(true);
  expect(() =>
    normalizeReadings(
      [fixtureRecord("chiller", { date: "invalid" })],
      fixtureFilter(),
      { chiller: null, freezer: null },
    ),
  ).toThrow("Tanggal/jam");
});
it("prints empty periods and adapts pagination to readable column widths", async () => {
  const r = fixtureReport("chiller", 1, []);
  expect(r.pages.length).toBeGreaterThan(1);
  expect(r.pages.every((p) => p.columns.length <= 30)).toBe(true);
  const scenes = buildControlScenes(r);
  expect(
    scenes
      .flatMap((p) => p.commands)
      .some(
        (c) =>
          c.kind === "text" && c.text.includes("Belum ada data pengukuran"),
      ),
  ).toBe(true);
  const pdf = await PDFDocument.load(await generateControlPdf(r));
  expect(pdf.getPageCount()).toBe(scenes.length);
  expect(pdf.getPage(0).getWidth()).toBe(842);
});
it("retains full correction text and names in appendices without synthesizing signatures", async () => {
  const r = fixtureReport();
  r.corrections = [
    {
      id: crypto.randomUUID(),
      recordId: r.readings[0].recordId,
      deviceType: "chiller",
      deviceNumber: 1,
      date: "2026-11-10",
      time: "07:30",
      description: "DATA UJI tindakan ".repeat(90),
      performedBy: "test",
      performedByName: "Petugas Uji",
      verificationStatus: "PENDING",
      verifiedBy: "",
      verifiedByName: "",
      verifiedAt: "",
      createdAt: "now",
      updatedAt: "now",
    },
  ];
  const scenes = buildControlScenes(r),
    commands = scenes.flatMap((s) => s.commands);
  expect(commands.some((c) => c.kind === "image")).toBe(false);
  expect(
    commands.some((c) => c.kind === "text" && c.text.includes("Petugas Uji")),
  ).toBe(true);
  expect(
    (await PDFDocument.load(await generateControlPdf(r))).getPageCount(),
  ).toBe(scenes.length);
});
it("embeds a signature only when the referenced image actually exists", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  vi.mocked(getFile).mockResolvedValue(png);
  const r = fixtureReport("chiller", 1, [
    fixtureRecord("chiller", { signatureId: "test-image" }),
  ]);
  expect((await generateControlPdf(r)).toString("latin1")).toContain(
    "/Subtype /Image",
  );
});
