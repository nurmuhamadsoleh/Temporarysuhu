import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import {
  FREEZER_TEMPERATURE_POLICY,
  DEFAULT_TEMPERATURE_POLICY,
  getFreezerStatus,
  getTemperatureStatus,
  countRecordedStatuses,
  emptyDeviceInput,
} from "@/lib/temperature-policy";
import { config } from "@/lib/domain";
import { TemperatureVerticalSlider } from "@/components/temperature/TemperatureVerticalSlider";
import {
  fixtureRecord,
  fixtureReport,
  fixtureFilter,
} from "./control-fixtures";
import { buildControlScenes } from "@/lib/temperature-report/scene";
import {
  temperatureY,
  normalizeReadings,
} from "@/lib/temperature-report/model";
vi.mock("@/lib/server/storage", () => ({ getFile: vi.fn() }));
import { generateControlPdf } from "@/lib/server/control-pdf";
const cases = [
  [-22, "LOW_TEMPERATURE", "#2563EB"],
  [-20, "LOW_TEMPERATURE", "#2563EB"],
  [-18.1, "LOW_TEMPERATURE", "#2563EB"],
  [-18, "NORMAL", "#16A34A"],
  [-15.5, "NORMAL", "#16A34A"],
  [-14, "NORMAL", "#16A34A"],
  [-10, "NORMAL", "#16A34A"],
  [-9.9, "WARNING", "#F59E0B"],
  [-8, "WARNING", "#F59E0B"],
  [-7.9, "HIGH_TEMPERATURE", "#DC2626"],
  [-6, "HIGH_TEMPERATURE", "#DC2626"],
  [null, "BELUM_DIISI", "#64748B"],
] as const;
describe("Initial Freezer SOP", () => {
  it.each(cases)(
    "classifies %s with status %s and its shared color",
    (value, code, color) => {
      expect(getFreezerStatus(value)).toBe(code);
      expect(
        getTemperatureStatus("freezer", value, DEFAULT_TEMPERATURE_POLICY),
      ).toMatchObject({
        code: code === "BELUM_DIISI" ? "UNFILLED" : code,
        color,
      });
    },
  );
  it("keeps the slider range, precision and ascending marks independent of normal limits", () => {
    expect(FREEZER_TEMPERATURE_POLICY).toEqual({
      minSlider: -22,
      maxSlider: -6,
      step: 0.1,
      normalMin: -18,
      normalMax: -10,
      warningMax: -8,
    });
    expect(config.freezer.options).toEqual([
      -22, -20, -18, -16, -14, -12, -10, -8, -6,
    ]);
    expect(getFreezerStatus(0)).toBe("HIGH_TEMPERATURE");
    expect(getFreezerStatus(-10 + 0.1)).toBe("WARNING");
  });
  it.each([1, 2, 3, 4])(
    "renders Freezer %s with the same normal policy, decimal value, accessible vertical direction and description",
    (number) => {
      const html = renderToStaticMarkup(
        <TemperatureVerticalSlider
          type="freezer"
          label={"Suhu Freezer " + number}
          value={-13.5}
          onChange={() => {}}
        />,
      );
      expect(html).toContain("-13,5°C");
      expect(html).toContain("NORMAL");
      expect(html).toContain("Suhu Freezer dalam rentang normal.");
      expect(html).toContain('aria-orientation="vertical"');
      expect(html).toContain('aria-valuemin="-22"');
      expect(html).toContain('aria-valuemax="-6"');
      expect(html).toContain("#16A34A");
    },
  );
  it("honors custom Warning limits and historical unconfigured SOP without changing Chiller", () => {
    const custom = {
      ...DEFAULT_TEMPERATURE_POLICY,
      version: "custom",
      freezer: { min: -18, max: -10, warningMax: -9 },
    };
    expect(getTemperatureStatus("freezer", -8.5, custom).code).toBe(
      "HIGH_TEMPERATURE",
    );
    expect(getFreezerStatus(-8.5)).toBe("WARNING");
    expect(
      getTemperatureStatus("freezer", -13.5, { ...custom, freezer: null }).code,
    ).toBe("UNKNOWN_SOP");
    expect(DEFAULT_TEMPERATURE_POLICY.chiller).toEqual({
      min: 0,
      max: 4,
      warningMax: 5,
    });
    expect(
      [0, 4, 4.1, 5, 5.1, -0.1].map(
        (v) =>
          getTemperatureStatus("chiller", v, DEFAULT_TEMPERATURE_POLICY).code,
      ),
    ).toEqual([
      "NORMAL",
      "NORMAL",
      "WARNING",
      "WARNING",
      "HIGH_TEMPERATURE",
      "LOW_TEMPERATURE",
    ]);
  });
  it("counts recorded assessments without reclassifying old unknown values", () => {
    const frozen = {
      ...DEFAULT_TEMPERATURE_POLICY,
      version: "old",
      freezer: null,
    };
    const record = fixtureRecord("freezer", {
      values: [-13.5, -18, -9.9, null],
      policy: frozen,
      policyVersion: frozen.version,
    });
    expect(countRecordedStatuses([record])).toMatchObject({
      NORMAL: 0,
      UNKNOWN_SOP: 3,
      UNFILLED: 1,
    });
  });
  it("uses the same status colors, Celsius coordinates and straight lines in PDF scenes and generated PDF", async () => {
    const values = [-18.1, -13.5, -9.9, -7.9];
    const records = values.map((v, i) => {
      const row = fixtureRecord("freezer", {
        values: [v, -13.5, -13.5, -13.5],
        time: ["03:00", "07:00", "11:00", "15:00"][i],
        policy: DEFAULT_TEMPERATURE_POLICY,
        policyVersion: DEFAULT_TEMPERATURE_POLICY.version,
      });
      row.deviceStates = row.values.map((value, index) => ({
        ...emptyDeviceInput(),
        deviceNumber: index + 1,
        temperatureStatus: getTemperatureStatus(
          "freezer",
          value,
          DEFAULT_TEMPERATURE_POLICY,
        ).code,
      }));
      return row;
    });
    const report = {
      ...fixtureReport("freezer", 1, records),
      sop: { min: -18, max: -10 },
    };
    expect(report.readings.map((r) => r.status)).toEqual([
      "LOW_TEMPERATURE",
      "NORMAL",
      "WARNING",
      "HIGH_TEMPERATURE",
    ]);
    const commands = buildControlScenes(report).flatMap((s) => s.commands);
    expect(
      commands.some(
        (c) =>
          c.kind === "text" && c.text === "Suhu Normal: -18,0°C s/d -10,0°C",
      ),
    ).toBe(true);
    expect(
      commands
        .filter((c) => c.kind === "circle" && c.readingIds?.length)
        .map((c) => c.kind === "circle" && c.color),
    ).toEqual(["#2563EB", "#16A34A", "#F59E0B", "#DC2626"]);
    expect(
      commands.filter((c) => c.kind === "line" && c.color === "#2563EB").length,
    ).toBeGreaterThanOrEqual(3);
    expect(temperatureY(-13.5, "freezer")).toBeCloseTo(7.5 / 16);
    const pdf = await generateControlPdf(report);
    expect(pdf.length).toBeGreaterThan(1000);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
  });
});

it("keeps unversioned Freezer null readings unfilled and never applies today's normal policy to historical readings", () => {
  const row = fixtureRecord("freezer", { values: [null, -13.5, -14, -15] });
  const sop = {
    chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
    freezer: DEFAULT_TEMPERATURE_POLICY.freezer,
  };
  expect(
    normalizeReadings([row], fixtureFilter("freezer", 1), sop)[0].status,
  ).toBe("UNFILLED");
  expect(
    normalizeReadings([row], fixtureFilter("freezer", 2), sop)[0].status,
  ).toBe("BELUM DIKONFIGURASI");
});
