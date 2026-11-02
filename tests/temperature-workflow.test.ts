import { beforeEach, expect, it, vi } from "vitest";
import type { sheets_v4 } from "googleapis";
import {
  emptyDeviceInput,
  DEFAULT_TEMPERATURE_POLICY,
} from "@/lib/temperature-policy";
import { measurementSchema } from "@/lib/domain";
const m = vi.hoisted(() => ({ get: vi.fn(), values: vi.fn(), batch: vi.fn() }));
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        get: m.get,
        values: { get: m.values },
        batchUpdate: m.batch,
      },
    }),
  },
}));
import {
  headers,
  createTemperatureRecord,
  getRecords,
  getTemperaturePolicy,
  saveTemperaturePolicy,
  ensureSheetHeaders,
  updateTemperatureRecord,
  getTemperatureStatistics,
} from "@/lib/server/sheets";
import { getCorrections, getControlData } from "@/lib/server/control-records";
const actor = {
  id: "operator",
  name: "Pemilik Pengukuran",
  email: "operator@example.test",
  role: "PETUGAS" as const,
};
const names = Object.keys(headers);
let tables: Record<string, unknown[][]>;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.test";
  process.env.GOOGLE_PRIVATE_KEY = "test";
  process.env.GOOGLE_SPREADSHEET_ID = "test";
  tables = Object.fromEntries(
    names.map((name) => [name, [[...headers[name]]]]),
  );
  m.get.mockImplementation(async () => ({
    data: {
      sheets: names.map((title, sheetId) => ({
        properties: { title, sheetId },
      })),
    },
  }));
  m.values.mockImplementation(async ({ range }: { range: string }) => ({
    data: { values: structuredClone(tables[range.split("'")[1]]) },
  }));
  m.batch.mockImplementation(
    async ({
      requestBody,
    }: {
      requestBody: { requests: sheets_v4.Schema$Request[] };
    }) => {
      const next = structuredClone(tables);
      for (const req of requestBody.requests) {
        const command = req.appendCells || req.updateCells;
        if (!command) continue;
        const range = req.updateCells?.range,
          sheetId = req.appendCells?.sheetId ?? range?.sheetId;
        const name = names[sheetId!];
        const rows = command.rows!.map((row) =>
          row.values!.map(
            (c) =>
              c.userEnteredValue?.numberValue ??
              c.userEnteredValue?.stringValue ??
              "",
          ),
        );
        if (req.appendCells) next[name].push(...rows);
        else
          rows.forEach((row, i) => {
            const index = range!.startRowIndex! + i;
            next[name][index] ??= [];
            row.forEach((v, j) => {
              next[name][index][range!.startColumnIndex! + j] = v;
            });
          });
      }
      tables = next;
      return {};
    },
  );
});
function input() {
  const signatureId = crypto.randomUUID();
  tables.SIGNATURE_METADATA.push([signatureId, actor.id, ""]);
  return measurementSchema("chiller").parse({
    date: "2026-11-02",
    time: "03:00",
    values: [0, 4.1, 5.1, -0.1, null],
    signatureId,
    notes: "DATA UJI",
    devices: [
      emptyDeviceInput(),
      emptyDeviceInput(),
      {
        ...emptyDeviceInput(),
        correctiveAction: "DATA UJI: menunggu pemeriksaan",
        performedBy: "Pelaksana Satu",
      },
      {
        ...emptyDeviceInput(),
        correctiveAction: "DATA UJI: perbaikan perangkat",
        performedBy: "Teknisi Dua",
        actionStatus: "PERBAIKAN",
      },
      { ...emptyDeviceInput(), missingReason: "Perangkat tidak beroperasi" },
    ],
  });
}
it("atomically saves null, reasons, per-device actions, actor identity and SOP version without duplicates", async () => {
  const body = input(),
    result = await createTemperatureRecord(
      "chiller",
      body,
      actor,
      "key",
      "hash",
    );
  expect(result.values).toEqual([0, 4.1, 5.1, -0.1, null]);
  expect(tables["Suhu Chiller"][1][7]).toBe("");
  expect(result.deviceStates?.map((d) => d.temperatureStatus)).toEqual([
    "NORMAL",
    "WARNING",
    "HIGH_TEMPERATURE",
    "LOW_TEMPERATURE",
    "UNFILLED",
  ]);
  expect(result.deviceStates?.[4].missingReason).toBe(
    "Perangkat tidak beroperasi",
  );
  expect(result.policyVersion).toBe(DEFAULT_TEMPERATURE_POLICY.version);
  const actions = await getCorrections();
  expect(actions).toHaveLength(2);
  expect(actions.map((a) => a.deviceNumber)).toEqual([3, 4]);
  expect(actions.map((a) => a.performedByName)).toEqual([
    "Pelaksana Satu",
    "Teknisi Dua",
  ]);
  expect(actions.map((a) => a.actionStatus)).toEqual(["PENDING", "PERBAIKAN"]);
  expect(
    actions.every((a) => a.verificationStatus === "PENDING" && !a.verifiedBy),
  ).toBe(true);
  const count = m.batch.mock.calls.length;
  await createTemperatureRecord("chiller", body, actor, "key", "hash");
  expect(m.batch).toHaveBeenCalledTimes(count);
  expect(await getCorrections()).toHaveLength(2);
});
it("rejects unfilled devices without reasons, missing required corrections and stale SOP versions", async () => {
  const body = input();
  body.devices![4].missingReason = "";
  await expect(
    createTemperatureRecord("chiller", body, actor, "k", "h"),
  ).rejects.toThrow("Alasan");
  body.devices![4].missingReason = "DATA UJI";
  body.devices![2].correctiveAction = "";
  await expect(
    createTemperatureRecord("chiller", body, actor, "k", "h"),
  ).rejects.toThrow("korektif");
  body.devices![2].correctiveAction = "DATA UJI";
  body.policyVersion = "stale";
  await expect(
    createTemperatureRecord("chiller", body, actor, "k", "h"),
  ).rejects.toThrow("Versi SOP");
  expect(tables["Suhu Chiller"]).toHaveLength(1);
  expect(m.batch).not.toHaveBeenCalled();
});
it("allows all-null measurements only with a reason for every device and excludes null from averages", async () => {
  const body = input();
  body.values.fill(null);
  body.devices = body.values.map(() => ({
    ...emptyDeviceInput(),
    missingReason: "DATA UJI: belum diukur",
  }));
  const record = await createTemperatureRecord(
    "chiller",
    body,
    actor,
    "k",
    "h",
  );
  expect(record.values.every((v) => v === null)).toBe(true);
  expect(await getCorrections()).toEqual([]);
  expect(
    getTemperatureStatistics([record], {
      chiller: { min: 0, max: 4 },
      freezer: null,
    }).chillerAverage,
  ).toBeNull();
});
it("protects policy changes server-side and preserves the historical assessment after SOP changes", async () => {
  const body = input(),
    record = await createTemperatureRecord("chiller", body, actor, "k", "h"),
    before = await getTemperaturePolicy();
  const bounds = {
    chiller: { min: 0, max: 6, warningMax: 7 },
    freezer: { min: -22, max: -18, warningMax: -17 },
  };
  await expect(
    saveTemperaturePolicy(bounds, before.version, actor),
  ).rejects.toThrow("Super Admin");
  await expect(
    saveTemperaturePolicy(bounds, "stale", { ...actor, role: "SUPER_ADMIN" }),
  ).rejects.toThrow("berubah");
  const next = await saveTemperaturePolicy(bounds, before.version, {
    ...actor,
    role: "SUPER_ADMIN",
  });
  expect(next.version).not.toBe(before.version);
  const historical = (await getRecords("chiller"))[0];
  expect(historical.policyVersion).toBe(record.policyVersion);
  expect(historical.deviceStates?.[2].temperatureStatus).toBe(
    "HIGH_TEMPERATURE",
  );
});
it("records Selesai separately from temperature and supervisor verification, with optimistic duplicate prevention", async () => {
  const body = input(),
    record = await createTemperatureRecord("chiller", body, actor, "k", "h");
  body.devices![2].actionStatus = "SELESAI";
  body.version = record.updatedAt;
  const next = await updateTemperatureRecord("chiller", record.id, body, actor);
  expect(next.deviceStates?.[2].temperatureStatus).toBe("HIGH_TEMPERATURE");
  const actions = await getCorrections(),
    completed = actions.find((a) => a.actionStatus === "SELESAI")!;
  expect(completed).toBeDefined();
  expect(completed.verificationStatus).toBe("PENDING");
  expect(completed.verifiedAt).toBe("");
  await expect(
    updateTemperatureRecord("chiller", record.id, body, actor),
  ).rejects.toThrow("berubah");
  expect(await getCorrections()).toHaveLength(2);
  const latest = await getControlData({
    kind: "chiller",
    deviceNumber: 3,
    month: 11,
    year: 2026,
    from: "2026-11-02",
    to: "2026-11-02",
    coldStorage: "",
    officer: "",
  });
  expect(latest.report.corrections).toHaveLength(1);
  expect(latest.report.corrections[0].id).toBe(completed.id);
  expect(latest.report.corrections[0].actionStatus).toBe("SELESAI");
});
it("extends only the known legacy action header without touching historical rows", async () => {
  tables.TEMPERATURE_CORRECTIVE_ACTIONS = [
    headers.TEMPERATURE_CORRECTIVE_ACTIONS.slice(0, 15),
    [
      "historical-action",
      "record",
      "chiller",
      1,
      "2026-10-31",
      "03:00",
      "Historical action",
      "owner",
      "VERIFIED",
      "verifier",
      "at",
      "created",
      "updated",
      "Original Performer",
      "Original Verifier",
    ],
  ];
  const original = structuredClone(tables.TEMPERATURE_CORRECTIVE_ACTIONS[1]);
  await ensureSheetHeaders(["TEMPERATURE_CORRECTIVE_ACTIONS"]);
  expect(tables.TEMPERATURE_CORRECTIVE_ACTIONS[0]).toEqual(
    headers.TEMPERATURE_CORRECTIVE_ACTIONS,
  );
  expect(tables.TEMPERATURE_CORRECTIVE_ACTIONS[1]).toEqual(original);
  expect((await getCorrections())[0].actionStatus).toBeUndefined();
});
it("maps report actions only to their source device and never plots a null as zero", async () => {
  await createTemperatureRecord("chiller", input(), actor, "key", "hash");
  const filter = {
    kind: "chiller" as const,
    deviceNumber: 3,
    month: 11,
    year: 2026,
    from: "2026-11-02",
    to: "2026-11-02",
    coldStorage: "",
    officer: "",
  };
  const high = await getControlData(filter);
  expect(high.report.corrections.map((a) => a.deviceNumber)).toEqual([3]);
  expect(high.report.corrections[0].actionStatus).toBe("PENDING");
  expect(high.report.readings[0].status).toBe("HIGH_TEMPERATURE");
  const missing = await getControlData({ ...filter, deviceNumber: 5 });
  expect(missing.report.readings[0].temperatureCelsius).toBeNull();
  expect(missing.report.readings[0].notes).toContain(
    "Perangkat tidak beroperasi",
  );
  expect(missing.report.pages.flatMap((p) => p.points)).toEqual([]);
  expect(missing.report.corrections).toEqual([]);
});
it("recovers an ambiguous Sheets response by the same idempotency key without orphaning or duplicating actions", async () => {
  const body = input(),
    commit = m.batch.getMockImplementation()!;
  m.batch.mockImplementationOnce(async (payload) => {
    await commit(payload);
    throw new Error("Connection lost after commit");
  });
  await expect(
    createTemperatureRecord("chiller", body, actor, "retry-key", "hash"),
  ).rejects.toMatchObject({ status: 503 });
  const result = await createTemperatureRecord(
    "chiller",
    body,
    actor,
    "retry-key",
    "hash",
  );
  expect(tables["Suhu Chiller"]).toHaveLength(2);
  expect((await getCorrections()).every((a) => a.recordId === result.id)).toBe(
    true,
  );
  expect(await getCorrections()).toHaveLength(2);
  expect(m.batch).toHaveBeenCalledTimes(1);
});
