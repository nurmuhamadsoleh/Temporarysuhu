import { it, expect, vi, beforeEach } from "vitest";
import { fixtureFilter, fixtureRecord } from "./control-fixtures";
const m = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[][]>,
  records: [] as unknown[],
  batch: vi.fn(),
}));
vi.mock("@/lib/server/sheets", () => ({
  ensureSheetHeaders: async () =>
    Object.fromEntries(
      [
        "TEMPERATURE_REPORT_CONFIG",
        "TEMPERATURE_CORRECTIVE_ACTIONS",
        "TEMPERATURE_REPORT_VERIFICATIONS",
        "AUDIT_LOG",
        "REPORTS",
        "SIGNATURE_METADATA",
      ].map((x) => [x, x]),
    ),
  rows: async (name: string) => m.tables[name] || [[]],
  getRecords: async () => m.records,
  allRecords: async () => m.records,
  getSop: async () => ({
    chiller: { min: 0, max: 4 },
    freezer: { min: -22, max: -18 },
  }),
  append: (sheetId: string, row: unknown[]) => ({ op: "append", sheetId, row }),
  replace: (sheetId: string, index: number, row: unknown[]) => ({
    op: "replace",
    sheetId,
    index,
    row,
  }),
  audit: () => ({ op: "audit" }),
  batch: m.batch,
}));
const file = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/server/storage", () => ({
  getFile: file.get,
  putFile: vi.fn(),
}));
import {
  getControlData,
  getCorrectiveActionsForReport,
  controlSettings,
  saveControlSettings,
  createCorrection,
  verifyCorrection,
  checkControlFresh,
} from "@/lib/server/control-records";
import { approveReport } from "@/lib/server/reports";
const actor = {
  id: "operator",
  name: "Petugas",
  email: "p@example.test",
  role: "PETUGAS" as const,
};
const supervisor = {
  ...actor,
  id: "supervisor",
  name: "Pemeriksa",
  role: "SUPERVISOR" as const,
};
it.each([
  ["chiller", 1],
  ["chiller", 5],
  ["freezer", 1],
  ["freezer", 4],
] as const)(
  "joins %s %s actions by record, device and original measurement date",
  async (kind, deviceNumber) => {
    const matching = fixtureRecord(kind, { date: "2026-11-10", time: "03:00" }),
      sameDayOther = fixtureRecord(kind, { date: "2026-11-10", time: "23:00" }),
      outside = fixtureRecord(kind, { date: "2026-10-31" });
    m.records = [matching, sameDayOther, outside];
    const action = (
      recordId: string,
      deviceType: string,
      number: number,
      description: string,
    ) => [
      crypto.randomUUID(),
      recordId,
      deviceType,
      number,
      "2027-01-01",
      "18:00",
      description,
      actor.id,
      "PENDING",
      "stale-verifier",
      "stale-at",
      "created",
      "updated",
      "Pelaksana Nyata",
      "Nama Pemeriksa Lama",
      1.8,
      "WARNING",
      "PERBAIKAN",
      actor.id,
      actor.id,
      "policy-v1",
    ];
    m.tables.TEMPERATURE_CORRECTIVE_ACTIONS = [
      [],
      action(matching.id, kind.toUpperCase(), deviceNumber, "Aksi terpilih"),
      action(sameDayOther.id, kind, deviceNumber, "Aksi malam"),
      action(matching.id, kind, deviceNumber === 1 ? 2 : 1, "Perangkat lain"),
      action(
        matching.id,
        kind === "chiller" ? "freezer" : "chiller",
        deviceNumber,
        "Jenis lain",
      ),
      action(outside.id, kind, deviceNumber, "Di luar periode"),
      action(
        crypto.randomUUID(),
        kind,
        deviceNumber,
        "Tanpa pengukuran sumber",
      ),
    ];
    const actions = await getCorrectiveActionsForReport({
      deviceType: kind,
      deviceNumber,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    expect(actions.map((a) => a.correctiveAction)).toEqual([
      "Aksi terpilih",
      "Aksi malam",
    ]);
    expect(actions.map((a) => a.measurementTime)).toEqual(["03:00", "23:00"]);
    expect(
      actions.every(
        (a) =>
          a.measurementDate === "2026-11-10" &&
          a.performedBy === "Pelaksana Nyata" &&
          a.actionStatus === "PERBAIKAN" &&
          !a.verifiedBy &&
          !a.verifiedAt,
      ),
    ).toBe(true);
  },
);
beforeEach(() => {
  vi.clearAllMocks();
  m.tables = {};
  m.records = [fixtureRecord("chiller", { createdBy: actor.id })];
  m.batch.mockImplementation(async (requests) => {
    for (const r of requests) {
      if (r.op === "audit") continue;
      const table = (m.tables[r.sheetId] ??= [[]]);
      if (r.op === "append") table.push(r.row);
      else table[r.index] = r.row;
    }
  });
});
it("protects settings permissions and optimistic versions", async () => {
  const current = await controlSettings();
  await expect(
    saveControlSettings(current.settings, current.version, actor),
  ).rejects.toMatchObject({ status: 403 });
  const admin = { ...actor, role: "ADMIN" as const };
  const saved = await saveControlSettings(
    current.settings,
    current.version,
    admin,
  );
  expect(saved.version).not.toBe("unconfigured");
  await expect(
    saveControlSettings(current.settings, "unconfigured", admin),
  ).rejects.toMatchObject({ status: 409 });
});
it("creates corrections idempotently, binds the real actor and enforces verification role/version", async () => {
  const record = m.records[0] as ReturnType<typeof fixtureRecord>,
    input = {
      recordId: record.id,
      deviceType: "chiller" as const,
      deviceNumber: 1,
      date: record.date,
      time: "07:15",
      description: "Tindakan pengujian",
    },
    id = crypto.randomUUID();
  const created = await createCorrection(input, actor, id);
  expect(created.performedBy).toBe(actor.id);
  expect((await createCorrection(input, actor, id)).id).toBe(id);
  expect(m.tables.TEMPERATURE_CORRECTIVE_ACTIONS).toHaveLength(2);
  await expect(
    createCorrection({ ...input, description: "changed" }, actor, id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    verifyCorrection(id, created.updatedAt, actor),
  ).rejects.toMatchObject({ status: 403 });
  const verified = await verifyCorrection(id, created.updatedAt, supervisor);
  expect(verified.verifiedBy).toBe(supervisor.id);
  expect(verified.verificationStatus).toBe("VERIFIED");
  await expect(
    verifyCorrection(id, created.updatedAt, supervisor),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    createCorrection(input, { ...actor, id: "foreign" }),
  ).rejects.toMatchObject({ status: 403 });
});
it("persists and audits invalidation exactly once after sources change", async () => {
  const { report } = await getControlData(fixtureFilter());
  m.tables.TEMPERATURE_REPORT_VERIFICATIONS = [
    [],
    [
      report.id,
      supervisor.id,
      "2026-11-01T00:00:00Z",
      "VERIFIED",
      "signature",
      report.sourceHash,
      "",
      supervisor.name,
    ],
  ];
  (m.records[0] as ReturnType<typeof fixtureRecord>).updatedAt = "changed";
  const state = await checkControlFresh(report, supervisor);
  expect(state.fresh).toBe(false);
  expect(state.verification?.status).toBe("INVALIDATED");
  const calls = m.batch.mock.calls.length;
  await checkControlFresh(report, supervisor);
  expect(m.batch).toHaveBeenCalledTimes(calls);
});
it("stores supervisor identity/signature with approval and rejects stale control snapshots", async () => {
  const { report: control, records } = await getControlData(fixtureFilter());
  const id = crypto.randomUUID();
  control.id = id;
  const snapshot = { id, control, records };
  file.get.mockResolvedValue(Buffer.from(JSON.stringify(snapshot)));
  m.tables.REPORTS = [[], [id, "at", actor.id, `${id}.json`, "DRAFT"]];
  m.tables.SIGNATURE_METADATA = [[], ["signature", supervisor.id, ""]];
  await approveReport(id, supervisor, "signature");
  expect(m.tables.TEMPERATURE_REPORT_VERIFICATIONS[1][1]).toBe(supervisor.id);
  expect(m.tables.TEMPERATURE_REPORT_VERIFICATIONS[1][4]).toBe("signature");
  m.tables.REPORTS[1][4] = "DRAFT";
  (m.records[0] as ReturnType<typeof fixtureRecord>).updatedAt = "changed";
  await expect(
    approveReport(id, supervisor, "signature"),
  ).rejects.toMatchObject({ status: 409 });
});
