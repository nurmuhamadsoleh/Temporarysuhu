import { describe, expect, it } from "vitest";
import {
  fixtureRecord,
  fixtureReport,
  fixtureFilter,
} from "./control-fixtures";
import {
  normalizeReadings,
  makeControlPages,
  defaultReportConfig,
} from "@/lib/temperature-report/model";
import { buildTemperatureLineSegments } from "@/lib/temperature-report/plot";
import {
  buildControlScenes,
  type DrawCommand,
} from "@/lib/temperature-report/scene";
import {
  DEFAULT_TEMPERATURE_POLICY,
  emptyDeviceInput,
  getTemperatureStatus,
} from "@/lib/temperature-policy";
describe("Shared control-sheet straight line chart", () => {
  it.each(["chiller", "freezer"] as const)(
    "connects %s markers chronologically without changing decimal coordinates",
    (kind) => {
      const records = ["15:00", "03:00", "11:00", "07:00"].map((time, i) =>
        fixtureRecord(kind, {
          time,
          values: Array(kind === "chiller" ? 5 : 4).fill(
            kind === "chiller"
              ? [2.4, 0, 1.2, 1.8][i]
              : [-18.5, -20.7, -17.3, -19.8][i],
          ),
        }),
      );
      const report = fixtureReport(kind, 1, records),
        page = report.pages[0],
        before = JSON.stringify(page);
      const segments = buildTemperatureLineSegments(page, report.readings);
      expect(
        segments.map(
          (s) =>
            s.fromTimestamp.slice(11, 16) + "-" + s.toTimestamp.slice(11, 16),
        ),
      ).toEqual(["03:00-07:00", "07:00-11:00", "11:00-15:00"]);
      expect(JSON.stringify(page)).toBe(before);
      for (const s of segments) {
        expect(page.points).toContain(s.from);
        expect(page.points).toContain(s.to);
        expect(Date.parse(s.fromTimestamp)).toBeLessThan(
          Date.parse(s.toTimestamp),
        );
      }
      const scene = buildControlScenes(report)[0],
        lines = scene.commands.filter(
          (c): c is Extract<DrawCommand, { kind: "line" }> =>
            c.kind === "line" && c.color === "#2563EB" && c.y >= 160,
        );
      expect(lines).toHaveLength(3);
      for (const s of segments) {
        const from = scene.commands.find(
            (c) =>
              c.kind === "circle" &&
              c.readingIds?.includes(s.from.readingIds[0]),
          ),
          to = scene.commands.find(
            (c) =>
              c.kind === "circle" && c.readingIds?.includes(s.to.readingIds[0]),
          );
        expect(
          lines.some(
            (l) =>
              l.x === from?.x &&
              l.y === from?.y &&
              l.x2 === to?.x &&
              l.y2 === to?.y &&
              l.weight === 2,
          ),
        ).toBe(true);
      }
    },
  );
  it.each(["absent", "null"])(
    "breaks across an %s scheduled slot by default",
    (mode) => {
      const records = [
        fixtureRecord("chiller", { time: "03:00" }),
        ...(mode === "null"
          ? [
              fixtureRecord("chiller", {
                time: "07:00",
                values: [null, 2, 3, 4, 5],
              }),
            ]
          : []),
        fixtureRecord("chiller", { time: "11:00" }),
      ];
      const report = fixtureReport("chiller", 1, records),
        page = report.pages[0];
      expect(buildTemperatureLineSegments(page, report.readings)).toEqual([]);
      expect(
        buildTemperatureLineSegments(page, report.readings, {
          connectAcrossGaps: true,
        }),
      ).toHaveLength(1);
      expect(page.points.every((p) => p.temperatureCelsius !== 0)).toBe(true);
      if (mode === "null")
        expect(
          buildControlScenes(report)[0].commands.some(
            (c) => c.kind === "text" && c.text === "BELUM",
          ),
        ).toBe(true);
    },
  );
  it("keeps extra times and joins actual midnight dates without shifting 03:00", () => {
    const records = [
      fixtureRecord("chiller", { time: "23:00" }),
      fixtureRecord("chiller", { date: "2026-11-11", time: "03:00" }),
      fixtureRecord("chiller", { time: "19:00" }),
      fixtureRecord("chiller", { time: "19:23" }),
    ];
    const report = fixtureReport("chiller", 1, records),
      segments = buildTemperatureLineSegments(report.pages[0], report.readings);
    expect(segments).toHaveLength(3);
    expect(segments[0].toTimestamp).toBe("2026-11-10T19:23:00+07:00");
    expect(segments.at(-1)?.toTimestamp).toBe("2026-11-11T03:00:00+07:00");
  });
  it("preserves all duplicates and breaks ambiguous timestamps instead of selecting or averaging", () => {
    const records = [
      fixtureRecord("chiller", { time: "03:00" }),
      ...Array.from({ length: 5 }, () =>
        fixtureRecord("chiller", { time: "07:00" }),
      ),
      fixtureRecord("chiller", { time: "11:00" }),
    ];
    const report = fixtureReport("chiller", 1, records),
      page = report.pages[0];
    expect(report.readings).toHaveLength(7);
    expect(page.points.flatMap((p) => p.readingIds)).toHaveLength(7);
    expect(buildTemperatureLineSegments(page, report.readings)).toEqual([]);
    expect(
      buildTemperatureLineSegments(page, report.readings, {
        connectAcrossGaps: true,
      }),
    ).toEqual([]);
  });
  it("supports chronological month transitions in the shared model", () => {
    const report = fixtureReport(),
      a = {
        ...report.readings[0],
        recordId: "a",
        date: "2026-11-30",
        time: "23:00",
        timestamp: "2026-11-30T23:00:00+07:00",
      },
      b = {
        ...a,
        recordId: "b",
        date: "2026-12-01",
        time: "03:00",
        timestamp: "2026-12-01T03:00:00+07:00",
      };
    const point = {
      x: 0.25,
      y: 0.5,
      readingIds: ["a"],
      count: 1,
      temperatureCelsius: 1.8,
      status: a.status,
    };
    const lines = buildTemperatureLineSegments(
      {
        columns: [
          { date: b.date, time: b.time, scheduled: true, readingIds: ["b"] },
          { date: a.date, time: a.time, scheduled: true, readingIds: ["a"] },
        ],
        points: [point, { ...point, x: 0.75, readingIds: ["b"] }],
      },
      [b, a],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].fromTimestamp).toBe(a.timestamp);
    expect(lines[0].toTimestamp).toBe(b.timestamp);
  });
  it("keeps line endpoints inside each page graph and preserves status colors", () => {
    const records = [0, 4.1, 5.1, -0.1].map((temperature, i) =>
      fixtureRecord("chiller", {
        time: ["03:00", "07:00", "11:00", "15:00"][i],
        values: [temperature, 1, 2, 3, 4],
        deviceStates: Array.from({ length: 5 }, (_, j) => ({
          ...emptyDeviceInput(),
          deviceNumber: j + 1,
          temperatureStatus: getTemperatureStatus(
            "chiller",
            j ? 1 : temperature,
            DEFAULT_TEMPERATURE_POLICY,
          ).code,
        })),
      }),
    );
    const report = fixtureReport("chiller", 1, records),
      scene = buildControlScenes(report)[0],
      points = scene.commands.filter(
        (c): c is Extract<DrawCommand, { kind: "circle" }> =>
          c.kind === "circle" && !!c.readingIds?.length,
      );
    expect(points.map((p) => p.color)).toEqual([
      "#16A34A",
      "#F59E0B",
      "#DC2626",
      "#2563EB",
    ]);
    for (const c of scene.commands.filter(
      (c): c is Extract<DrawCommand, { kind: "line" }> =>
        c.kind === "line" && c.color === "#2563EB" && c.y >= 160,
    )) {
      expect(c.x).toBeGreaterThanOrEqual(76);
      expect(c.x2).toBeLessThanOrEqual(818);
      expect(c.y).toBeGreaterThanOrEqual(160);
      expect(c.y2).toBeLessThanOrEqual(350);
    }
    const filter = { ...fixtureFilter(), from: "2026-11-10", to: "2026-11-11" },
      readings = normalizeReadings(records, filter, {
        chiller: null,
        freezer: null,
      }),
      pages = makeControlPages(readings, filter, {
        ...defaultReportConfig,
        daysPerPage: 1,
      });
    expect(pages).toHaveLength(2);
    expect(buildTemperatureLineSegments(pages[1], readings)).toEqual([]);
  });
  it("uses neutral markers for Freezer without a SOP", () => {
    const filter = {
        ...fixtureFilter("freezer"),
        from: "2026-11-10",
        to: "2026-11-10",
      },
      report = fixtureReport("freezer", 1, [
        fixtureRecord("freezer", { time: "03:00" }),
        fixtureRecord("freezer", { time: "07:00" }),
      ]);
    report.readings = normalizeReadings(
      [
        fixtureRecord("freezer", { time: "03:00" }),
        fixtureRecord("freezer", { time: "07:00" }),
      ],
      filter,
      { chiller: null, freezer: null },
    );
    report.sop = null;
    report.pages = makeControlPages(report.readings, filter, report.settings);
    expect(
      buildControlScenes(report)
        .flatMap((p) => p.commands)
        .filter(
          (c): c is Extract<DrawCommand, { kind: "circle" }> =>
            c.kind === "circle" && !!c.readingIds?.length,
        )
        .every((c) => c.color === "#64748B"),
    ).toBe(true);
  });
});
