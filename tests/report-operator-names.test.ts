import { beforeEach, expect, it, vi } from "vitest";
import { fixtureRecord, fixtureReport } from "./control-fixtures";
import { buildFullNamePages } from "@/lib/temperature-report/name-layout";
import { buildControlScenes } from "@/lib/temperature-report/scene";
const users = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/user-service", () => ({ userTable: users }));
vi.mock("@/lib/server/safe-log", () => ({ safeLog: vi.fn() }));
import { buildTemperatureReportData } from "@/lib/server/report-data";
beforeEach(() => {
  users.mockResolvedValue({
    users: [
      { id: "owner-a", name: "Nur Muhamad Soleh" },
      { id: "owner-b", name: "Petugas Lain" },
      { id: "viewer", name: "Administrator Pembaca" },
    ],
  });
});
it.each(["chiller", "freezer"] as const)(
  "prints actual %s owners in the appropriate time cells even when saved settings request codes",
  async (kind) => {
    const source = fixtureReport(kind, 1, [
      fixtureRecord(kind, {
        time: "07:00",
        createdBy: "owner-a",
        officer: "ns",
      }),
      fixtureRecord(kind, {
        time: "11:00",
        createdBy: "owner-b",
        officer: "lain",
      }),
      fixtureRecord(kind, {
        time: "15:00",
        createdBy: "owner-a",
        officer: "ns",
      }),
    ]);
    source.settings.operatorStyle = "initials";
    const before = JSON.stringify(source),
      report = await buildTemperatureReportData(source),
      pages = buildFullNamePages(report);
    const names = pages.flatMap((p) =>
      p.nameCells
        .filter((c) => c.names.length)
        .map((c) => ({ time: p.page.columns[c.start].time, names: c.names })),
    );
    expect(names).toEqual([
      { time: "07:00", names: ["Nur Muhamad Soleh"] },
      { time: "11:00", names: ["Petugas Lain"] },
      { time: "15:00", names: ["Nur Muhamad Soleh"] },
    ]);
    expect(report.readings.map((r) => r.operatorFullName)).toEqual([
      "Nur Muhamad Soleh",
      "Petugas Lain",
      "Nur Muhamad Soleh",
    ]);
    const text = buildControlScenes(report)
      .flatMap((p) => p.commands)
      .filter((c) => c.kind === "text")
      .map((c) => c.text)
      .join("\n");
    expect(text).not.toMatch(/\bP\d+\b/);
    expect(text).not.toContain("Administrator Pembaca");
    expect(text).not.toMatch(/\bns\b/);
    expect(text).toContain("Nur Muhamad Soleh");
    expect(JSON.stringify(source)).toBe(before);
  },
);
it("uses historical names then Tidak diketahui without printing UUIDs, email or generated codes", async () => {
  const report = await buildTemperatureReportData(
    fixtureReport("chiller", 1, [
      fixtureRecord("chiller", {
        createdBy: "missing",
        officer: "Nama Historis",
      }),
      fixtureRecord("chiller", { createdBy: "unknown", officer: "" }),
      fixtureRecord("chiller", { createdBy: "unknown-2", officer: "P2" }),
      fixtureRecord("chiller", {
        createdBy: "unknown-3",
        officer: "private@example.test",
      }),
    ]),
  );
  expect(report.readings.map((r) => r.operatorFullName).sort()).toEqual([
    "Nama Historis",
    "Tidak diketahui",
    "Tidak diketahui",
    "Tidak diketahui",
  ]);
  const text = buildControlScenes(report)
    .flatMap((p) => p.commands)
    .filter((c) => c.kind === "text")
    .map((c) => c.text)
    .join("\n");
  expect(text).not.toMatch(/\bP\d+\b|@/);
});
it("merges only consecutive cells with the same owners and never crosses an empty or different-owner cell", async () => {
  const report = await buildTemperatureReportData(
    fixtureReport("chiller", 1, [
      fixtureRecord("chiller", { time: "03:00", createdBy: "owner-a" }),
      fixtureRecord("chiller", { time: "07:00", createdBy: "owner-a" }),
      fixtureRecord("chiller", { time: "15:00", createdBy: "owner-a" }),
      fixtureRecord("chiller", { time: "19:00", createdBy: "owner-b" }),
    ]),
  );
  const cells = buildFullNamePages(report).flatMap((p) =>
    p.nameCells
      .filter((c) => c.names.length)
      .map((c) => ({
        from: p.page.columns[c.start].time,
        to: p.page.columns[c.end - 1].time,
        names: c.names,
      })),
  );
  expect(cells).toEqual([
    { from: "03:00", to: "07:00", names: ["Nur Muhamad Soleh"] },
    { from: "15:00", to: "15:00", names: ["Nur Muhamad Soleh"] },
    { from: "19:00", to: "19:00", names: ["Petugas Lain"] },
  ]);
});
it("paginates and wraps long names without shrinking fonts, clipping names or losing readings", async () => {
  const name = "W".repeat(150),
    source = fixtureReport("chiller", 1, [
      fixtureRecord("chiller", {
        createdBy: "long",
        signatureId: "original-signature",
      }),
    ]),
    report = await buildTemperatureReportData(source, [{ id: "long", name }]);
  const pages = buildFullNamePages(report),
    visible = pages
      .flatMap((p) => p.nameCells)
      .find((c) => c.names.includes(name))!;
  expect(visible.lines.join("")).toBe(name);
  expect(pages.every((p) => p.nameHeight <= 96)).toBe(true);
  expect(
    pages.flatMap((p) => p.page.points).flatMap((p) => p.readingIds),
  ).toEqual(source.pages.flatMap((p) => p.points).flatMap((p) => p.readingIds));
  const commands = buildControlScenes(report).flatMap((p) => p.commands);
  expect(
    commands.some(
      (c) =>
        c.kind === "image" && c.signatureReference === "original-signature",
    ),
  ).toBe(true);
});
it("does not invent one operator when several people recorded the same slot", async () => {
  const report = await buildTemperatureReportData(
    fixtureReport("chiller", 1, [
      fixtureRecord("chiller", { createdBy: "owner-a" }),
      fixtureRecord("chiller", { createdBy: "owner-b" }),
    ]),
  );
  const cell = buildFullNamePages(report)
    .flatMap((p) => p.nameCells)
    .find((c) => c.names.length === 2)!;
  expect(cell.names).toEqual(["Nur Muhamad Soleh", "Petugas Lain"]);
  expect(report.readings).toHaveLength(2);
});
it("keeps every full name in an explicitly identified continuation when a slot has many operators", async () => {
  const identities = Array.from({ length: 15 }, (_, i) => ({
    id: `many-${i}`,
    name: `Petugas ${i} ${"W".repeat(130)}`,
  }));
  const report = await buildTemperatureReportData(
    fixtureReport(
      "chiller",
      1,
      identities.map((u) => fixtureRecord("chiller", { createdBy: u.id })),
    ),
    identities,
  );
  const pages = buildFullNamePages(report);
  expect(pages.every((p) => p.nameHeight <= 96)).toBe(true);
  expect(pages.some((p) => p.nameCells.some((c) => c.continued))).toBe(true);
  const continuation = buildControlScenes(report)
    .filter((p) => p.label === "Nama Petugas (lanjutan)")
    .flatMap((p) => p.commands)
    .filter((c) => c.kind === "text")
    .map((c) => c.text)
    .join("\n");
  for (let i = 0; i < 15; i++) expect(continuation).toContain(`Petugas ${i}`);
  expect(report.readings).toHaveLength(15);
});
