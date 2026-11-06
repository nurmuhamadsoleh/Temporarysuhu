import {
  defaultDevices,
  measurementRefs,
  measurementValue,
} from "@/lib/devices";
const signatureBytes = Buffer.from("fixture signature file");
const signatureHash = createHash("sha256").update(signatureBytes).digest("hex");
import { beforeEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
vi.mock("@/lib/server/storage", () => ({
  getFile: async () => Buffer.from("fixture signature file"),
}));
const testPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
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
  deleteTemperatureRecord,
  getTemperatureStatistics,
  getTemperatureDevices,
  registerTemperatureDevice,
  setTemperatureDeviceActive,
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
  process.env.GOOGLE_PRIVATE_KEY = testPrivateKey;
  process.env.GOOGLE_SPREADSHEET_ID = "test-spreadsheet-identifier";
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
  tables.SIGNATURE_METADATA.push([
    signatureId,
    actor.id,
    "",
    "at",
    signatureId + ".png",
    signatureHash,
  ]);
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

it("introduces the initial Freezer SOP for a pre-update unset config without writing or changing Chiller", async () => {
  const old = {
    version: "pre-update-policy",
    bounds: { chiller: { min: 1, max: 3, warningMax: 4 }, freezer: null },
  };
  tables.APP_CONFIG.push(["TEMPERATURE_POLICY", JSON.stringify(old)]);
  const original = structuredClone(tables.APP_CONFIG),
    policy = await getTemperaturePolicy();
  expect(policy.chiller).toEqual(old.bounds.chiller);
  expect(policy.freezer).toEqual({ min: -18, max: -10, warningMax: -8 });
  expect(policy.version).not.toBe(old.version);
  expect((await getTemperaturePolicy()).version).toBe(policy.version);
  expect(tables.APP_CONFIG).toEqual(original);
  expect(m.batch).not.toHaveBeenCalled();
});
it("keeps a custom Freezer SOP and honors explicit administrator opt-out on new policy versions", async () => {
  const before = await getTemperaturePolicy(),
    admin = { ...actor, role: "SUPER_ADMIN" as const };
  const configured = await saveTemperaturePolicy(
    {
      chiller: before.chiller,
      freezer: { min: -18, max: -10, warningMax: -9 },
    },
    before.version,
    admin,
  );
  expect((await getTemperaturePolicy()).freezer?.warningMax).toBe(-9);
  const disabled = await saveTemperaturePolicy(
    { chiller: before.chiller, freezer: null },
    configured.version,
    admin,
  );
  expect((await getTemperaturePolicy()).freezer).toBeNull();
  expect((await getTemperaturePolicy()).version).toBe(disabled.version);
});
it("saves all four Freezers with decimal values, per-device statuses, corrections and a policy snapshot used by history, statistics and reports", async () => {
  const body = measurementSchema("freezer").parse({
    ...input(),
    values: [-13.5, -18, -9.9, -7.9],
    devices: [
      emptyDeviceInput(),
      emptyDeviceInput(),
      emptyDeviceInput(),
      {
        ...emptyDeviceInput(),
        correctiveAction: "DATA UJI: pemeriksaan Freezer 4",
        performedBy: "Pelaksana Uji",
      },
    ],
  });
  const record = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "freezer-key",
    "freezer-hash",
  );
  expect(record.values).toEqual([-13.5, -18, -9.9, -7.9]);
  expect(record.deviceStates?.map((d) => d.temperatureStatus)).toEqual([
    "NORMAL",
    "NORMAL",
    "WARNING",
    "HIGH_TEMPERATURE",
  ]);
  expect(record.policy?.freezer).toEqual({
    min: -18,
    max: -10,
    warningMax: -8,
  });
  expect(record.policyVersion).toBe(DEFAULT_TEMPERATURE_POLICY.version);
  const actions = await getCorrections();
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    recordId: record.id,
    deviceType: "freezer",
    deviceNumber: 4,
    actionStatus: "PENDING",
    performedByName: "Pelaksana Uji",
  });
  const next = await saveTemperaturePolicy(
    {
      chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
      freezer: { min: -22, max: -18, warningMax: -17 },
    },
    record.policyVersion!,
    { ...actor, role: "SUPER_ADMIN" },
  );
  const historic = (await getRecords("freezer")).find(
    (r) => r.id === record.id,
  )!;
  expect(historic.policyVersion).toBe(record.policyVersion);
  expect(historic.deviceStates).toEqual(record.deviceStates);
  const stats = getTemperatureStatistics([historic], {
    chiller: next.chiller,
    freezer: next.freezer,
  });
  expect(stats.freezerStatusCounts).toMatchObject({
    NORMAL: 2,
    WARNING: 1,
    HIGH_TEMPERATURE: 1,
    LOW_TEMPERATURE: 0,
  });
  expect(stats.alerts).toBe(2);
  const filter = {
    kind: "freezer" as const,
    deviceNumber: 1,
    month: 11,
    year: 2026,
    from: "2026-11-02",
    to: "2026-11-02",
    coldStorage: "",
    officer: "",
  };
  const report = await getControlData(filter);
  expect(report.report.sop).toEqual({ min: -18, max: -10 });
  expect(report.report.readings[0]).toMatchObject({
    temperatureCelsius: -13.5,
    status: "NORMAL",
    policyVersion: record.policyVersion,
  });
  const high = await getControlData({ ...filter, deviceNumber: 4 });
  expect(high.report.readings[0].status).toBe("HIGH_TEMPERATURE");
  expect(high.report.corrections.map((a) => a.deviceNumber)).toEqual([4]);
});
it("keeps historical Freezer readings unassessed under their original null policy after the new SOP is adopted", async () => {
  const old = {
    version: "historic-unset",
    freezerPolicyExplicit: true,
    bounds: { chiller: DEFAULT_TEMPERATURE_POLICY.chiller, freezer: null },
  };
  tables.APP_CONFIG.push(["TEMPERATURE_POLICY", JSON.stringify(old)]);
  const body = measurementSchema("freezer").parse({
    ...input(),
    date: "2026-11-01",
    values: [-13.5, -18, -9.9, -7.9],
    devices: Array.from({ length: 4 }, emptyDeviceInput),
  });
  const record = await createTemperatureRecord(
      "freezer",
      body,
      actor,
      "historic-key",
      "historic-hash",
    ),
    original = structuredClone(tables["Suhu Freezer"][1]);
  expect(
    record.deviceStates?.every((d) => d.temperatureStatus === "UNKNOWN_SOP"),
  ).toBe(true);
  await saveTemperaturePolicy(
    {
      chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
      freezer: DEFAULT_TEMPERATURE_POLICY.freezer,
    },
    old.version,
    { ...actor, role: "SUPER_ADMIN" },
  );
  const historical = (await getRecords("freezer"))[0];
  expect(historical.policyVersion).toBe(old.version);
  expect(historical.deviceStates).toEqual(record.deviceStates);
  expect(tables["Suhu Freezer"][1]).toEqual(original);
  expect(
    getTemperatureStatistics([historical], {
      chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
      freezer: DEFAULT_TEMPERATURE_POLICY.freezer,
    }).freezerStatusCounts,
  ).toMatchObject({ NORMAL: 0, UNKNOWN_SOP: 4 });
  const data = await getControlData({
    kind: "freezer",
    deviceNumber: 1,
    month: 11,
    year: 2026,
    from: "2026-11-01",
    to: "2026-11-01",
    coldStorage: "",
    officer: "",
  });
  expect(data.report.readings[0].status).toBe("UNKNOWN_SOP");
  expect(data.report.sop).toBeNull();
  expect(data.report.normalRangeNote).toBe("Belum ditetapkan saat pencatatan");
  // Presentation labels must not change the established source hash contract.
  const originalSourceHash = createHash("sha256")
    .update(
      JSON.stringify({
        filter: data.report.filter,
        settings: data.report.settings,
        version: data.report.settingsVersion,
        sop: null,
        readings: [...data.report.readings].sort((a, b) =>
          a.recordId.localeCompare(b.recordId),
        ),
        corrections: [],
      }),
    )
    .digest("hex");
  expect(data.report.sourceHash).toBe(originalSourceHash);
});

it("saves four missing Freezer readings as null with their own reasons, never zeros or invented actions", async () => {
  const body = measurementSchema("freezer").parse({
    ...input(),
    values: [null, null, null, null],
    devices: Array.from({ length: 4 }, (_, i) => ({
      ...emptyDeviceInput(),
      missingReason: "DATA UJI: Freezer " + (i + 1) + " tidak beroperasi",
    })),
  });
  const saved = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "missing-freezer-key",
    "missing-freezer-hash",
  );
  expect(saved.values).toEqual([null, null, null, null]);
  expect(tables["Suhu Freezer"][1].slice(3, 7)).toEqual(["", "", "", ""]);
  expect(
    saved.deviceStates?.every(
      (d) => d.temperatureStatus === "UNFILLED" && d.missingReason,
    ),
  ).toBe(true);
  expect(await getCorrections()).toEqual([]);
  expect(
    getTemperatureStatistics([saved], {
      chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
      freezer: DEFAULT_TEMPERATURE_POLICY.freezer,
    }),
  ).toMatchObject({
    freezerAverage: null,
    freezerStatusCounts: { UNFILLED: 4, NORMAL: 0 },
  });
});

function dynamicFreezer(
  values: (number | null)[],
  refs = defaultDevices("freezer").map((d) => ({ id: d.id, number: d.number })),
) {
  return measurementSchema("freezer").parse({
    ...input(),
    values,
    deviceRefs: refs,
    devices: values.map((v, index) => ({
      ...emptyDeviceInput(),
      missingReason: v === null ? "DATA UJI: alat tidak beroperasi" : "",
      correctiveAction:
        v !== null && (v < -18 || v > -8)
          ? "DATA UJI: pemeriksaan perangkat " + refs[index].number
          : "",
      performedBy: v !== null && (v < -18 || v > -8) ? "Pelaksana Uji" : "",
    })),
  });
}
it("reads five Chillers and six Freezers, registers a permanent seventh device once, and never reuses deactivated numbers", async () => {
  const initial = await getTemperatureDevices();
  expect(initial.filter((d) => d.kind === "chiller")).toHaveLength(5);
  expect(initial.filter((d) => d.kind === "freezer")).toHaveLength(6);
  expect(m.batch).not.toHaveBeenCalled();
  const admin = { ...actor, role: "SUPER_ADMIN" as const },
    id = crypto.randomUUID();
  await expect(
    registerTemperatureDevice("freezer", id, actor),
  ).rejects.toMatchObject({ status: 403 });
  const added = await registerTemperatureDevice("freezer", id, admin, 7);
  expect(added.number).toBe(7);
  const writes = m.batch.mock.calls.length;
  expect(await registerTemperatureDevice("freezer", id, admin, 7)).toEqual(
    added,
  );
  expect(m.batch).toHaveBeenCalledTimes(writes);
  expect(
    (await getTemperatureDevices()).filter((d) => d.kind === "freezer"),
  ).toHaveLength(7);
  const inactive = await setTemperatureDeviceActive(
    id,
    false,
    added.version,
    admin,
  );
  expect((await getTemperatureDevices()).some((d) => d.id === id)).toBe(false);
  expect(
    (await getTemperatureDevices(true)).find((d) => d.id === id)?.active,
  ).toBe(false);
  const eighth = await registerTemperatureDevice(
    "freezer",
    crypto.randomUUID(),
    admin,
    8,
  );
  expect(eighth.number).toBe(8);
  await setTemperatureDeviceActive(id, true, inactive.version, admin);
  expect((await getTemperatureDevices()).some((d) => d.id === id)).toBe(true);
});
it("persists six Freezers in normalized rows while keeping all existing legacy metadata columns and old records unchanged", async () => {
  const legacy = measurementSchema("freezer").parse({
    ...input(),
    values: [-18, -15.5, -13.5, -10],
    devices: Array.from({ length: 4 }, emptyDeviceInput),
  });
  const old = await createTemperatureRecord(
      "freezer",
      legacy,
      actor,
      "legacy-four",
      "legacy-hash",
    ),
    oldRow = structuredClone(tables["Suhu Freezer"][1]);
  const body = dynamicFreezer([-18, -15.5, -13.5, -10, null, -7.9]);
  const saved = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "dynamic-six",
    "six-hash",
  );
  expect(saved.values).toEqual(body.values);
  expect(saved.deviceRefs).toEqual(body.deviceRefs);
  expect(saved.deviceStates?.map((d) => d.deviceNumber)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(saved.deviceStates?.[5].temperatureStatus).toBe("HIGH_TEMPERATURE");
  expect(tables["Suhu Freezer"][1]).toEqual(oldRow);
  expect(tables["Suhu Freezer"][2]).toHaveLength(
    headers["Suhu Freezer"].length,
  );
  expect(tables["Suhu Freezer"][2][7]).toBe(actor.name);
  expect(tables["Suhu Freezer"][2].slice(3, 7)).toEqual([
    -18, -15.5, -13.5, -10,
  ]);
  expect(tables.TEMPERATURE_READINGS).toHaveLength(7);
  expect(tables.TEMPERATURE_READINGS.slice(1).map((r) => r[5])).toEqual([
    -18,
    -15.5,
    -13.5,
    -10,
    "",
    -7.9,
  ]);
  const before = m.batch.mock.calls.length;
  expect(
    (
      await createTemperatureRecord(
        "freezer",
        body,
        actor,
        "dynamic-six",
        "six-hash",
      )
    ).id,
  ).toBe(saved.id);
  expect(m.batch).toHaveBeenCalledTimes(before);
  expect(
    (await getRecords("freezer")).find((r) => r.id === old.id)?.values,
  ).toEqual(legacy.values);
  expect(
    (await getCorrections()).map((a) => [a.recordId, a.deviceNumber]),
  ).toEqual([[saved.id, 6]]);
  const report = await getControlData({
    kind: "freezer",
    deviceNumber: 6,
    month: 11,
    year: 2026,
    from: "2026-11-02",
    to: "2026-11-02",
    coldStorage: "",
    officer: "",
  });
  expect(report.report.readings).toHaveLength(1);
  expect(report.report.readings[0]).toMatchObject({
    temperatureCelsius: -7.9,
    deviceNumber: 6,
    deviceId: body.deviceRefs![5].id,
  });
  expect(report.report.corrections).toHaveLength(1);
});
it("keeps device identities, values and report actions aligned across inactive gaps and protects historical edit mappings", async () => {
  const admin = { ...actor, role: "SUPER_ADMIN" as const },
    added = await registerTemperatureDevice(
      "freezer",
      crypto.randomUUID(),
      admin,
      7,
    ),
    second = (await getTemperatureDevices()).find(
      (d) => d.kind === "freezer" && d.number === 2,
    )!;
  await setTemperatureDeviceActive(second.id, false, second.version, admin);
  const devices = (await getTemperatureDevices()).filter(
      (d) => d.kind === "freezer",
    ),
    refs = devices.map((d) => ({ id: d.id, number: d.number }));
  const body = dynamicFreezer(
      devices.map((d) => (d.number === 7 ? -7.9 : -13.5)),
      refs,
    ),
    saved = await createTemperatureRecord(
      "freezer",
      body,
      actor,
      "gaps",
      "gap-hash",
    );
  expect(measurementValue(saved, 7)).toBe(-7.9);
  expect(measurementValue(saved, 2)).toBeUndefined();
  expect(tables["Suhu Freezer"][1][4]).toBe("");
  const f = {
    kind: "freezer" as const,
    deviceNumber: 7,
    month: 11,
    year: 2026,
    from: "2026-11-02",
    to: "2026-11-02",
    coldStorage: "",
    officer: "",
  };
  const report = await getControlData(f);
  expect(report.report.readings[0].temperatureCelsius).toBe(-7.9);
  expect(report.report.corrections[0].deviceNumber).toBe(7);
  expect(
    (await getControlData({ ...f, deviceNumber: 2 })).report.readings,
  ).toEqual([]);
  await expect(
    updateTemperatureRecord(
      "freezer",
      saved.id,
      {
        ...body,
        version: saved.updatedAt,
        values: body.values.slice(0, -1),
        devices: body.devices?.slice(0, -1),
        deviceRefs: body.deviceRefs?.slice(0, -1),
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await setTemperatureDeviceActive(added.id, false, added.version, admin);
  const changed = {
    ...body,
    version: saved.updatedAt,
    values: body.values.map(() => -13.5),
  };
  const edited = await updateTemperatureRecord(
    "freezer",
    saved.id,
    changed,
    actor,
  );
  expect(measurementRefs(edited)).toEqual(refs);
  expect(measurementValue(edited, 7)).toBe(-13.5);
});
it("rejects fabricated devices and stale provisional numbers without creating a measurement", async () => {
  const refs = defaultDevices("freezer").map((d) => ({
    id: d.id,
    number: d.number,
  }));
  refs[5] = { id: crypto.randomUUID(), number: 6 };
  const body = dynamicFreezer([-13.5, -13.5, -13.5, -13.5, -13.5, -13.5], refs);
  await expect(
    createTemperatureRecord("freezer", body, actor, "bad-device", "hash"),
  ).rejects.toMatchObject({ status: 400 });
  expect(tables["Suhu Freezer"]).toHaveLength(1);
  await expect(
    registerTemperatureDevice(
      "freezer",
      crypto.randomUUID(),
      { ...actor, role: "SUPER_ADMIN" },
      9,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(tables.TEMPERATURE_DEVICES).toHaveLength(1);
});
it("recovers a dynamic measurement after a committed response is lost without duplicating readings or corrective actions", async () => {
  const body = dynamicFreezer([-13.5, -13.5, -13.5, -13.5, null, -7.9]),
    commit = m.batch.getMockImplementation()!;
  m.batch.mockImplementationOnce(async (payload) => {
    await commit(payload);
    throw new Error("Fixture lost response after commit");
  });
  await expect(
    createTemperatureRecord("freezer", body, actor, "dynamic-retry", "hash"),
  ).rejects.toMatchObject({ status: 503 });
  const saved = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "dynamic-retry",
    "hash",
  );
  expect(saved.values).toEqual(body.values);
  expect(tables.TEMPERATURE_READINGS).toHaveLength(7);
  expect(tables["Suhu Freezer"]).toHaveLength(2);
  expect(await getCorrections()).toHaveLength(1);
  expect(m.batch).toHaveBeenCalledTimes(1);
});

it("rejects legacy requests for inactive devices before measurement writes", async () => {
  const admin = { ...actor, role: "SUPER_ADMIN" as const };
  const device = (await getTemperatureDevices()).find(
    (d) => d.kind === "freezer" && d.number === 2,
  )!;
  await setTemperatureDeviceActive(device.id, false, device.version, admin);
  const legacy = measurementSchema("freezer").parse({
    ...input(),
    values: [-13.5, -13.5, -13.5, -13.5],
    devices: Array.from({ length: 4 }, emptyDeviceInput),
  });
  const calls = m.batch.mock.calls.length;
  await expect(
    createTemperatureRecord(
      "freezer",
      legacy,
      actor,
      "inactive-legacy",
      "hash",
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(m.batch).toHaveBeenCalledTimes(calls);
  expect(tables["Suhu Freezer"]).toHaveLength(1);
});
it("rejects downgrading a dynamic measurement to legacy fields without device identities", async () => {
  const body = dynamicFreezer([-13.5, -13.5, -13.5, -13.5, -13.5, -13.5]);
  const record = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "keep-identities",
    "hash",
  );
  const original = structuredClone(tables),
    calls = m.batch.mock.calls.length;
  const { deviceRefs: omitted, ...fields } = body;
  expect(omitted).toHaveLength(6);
  await expect(
    updateTemperatureRecord(
      "freezer",
      record.id,
      {
        ...fields,
        values: fields.values.slice(0, 4),
        devices: fields.devices?.slice(0, 4),
        version: record.updatedAt,
      },
      actor,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(m.batch).toHaveBeenCalledTimes(calls);
  expect(tables).toEqual(original);
});
it.each(["missing", "legacy-array"])(
  "fails safely for %s normalized manifests rather than truncating readings to legacy columns",
  async (scenario) => {
    const body = dynamicFreezer([-13.5, -13.5, -13.5, -13.5, -13.5, -13.5]);
    const saved = await createTemperatureRecord(
      "freezer",
      body,
      actor,
      "manifest-" + scenario,
      "hash",
    );
    const row = tables.TEMPERATURE_DEVICE_STATES.findIndex(
      (r) => r[0] === saved.id,
    );
    if (scenario === "missing") tables.TEMPERATURE_DEVICE_STATES.splice(row, 1);
    else
      tables.TEMPERATURE_DEVICE_STATES[row][2] = JSON.stringify(
        saved.deviceStates,
      );
    const calls = m.batch.mock.calls.length;
    await expect(getRecords("freezer")).rejects.toMatchObject({ status: 409 });
    expect(m.batch).toHaveBeenCalledTimes(calls);
    expect(tables.TEMPERATURE_READINGS.slice(1)).toHaveLength(6);
  },
);

it("preserves all dynamic readings and identities in the authorized delete audit", async () => {
  const body = dynamicFreezer([-13.5, -13.5, -13.5, -13.5, -13.5, -13.5]);
  const saved = await createTemperatureRecord(
    "freezer",
    body,
    actor,
    "audit-delete-six",
    "hash",
  );
  await deleteTemperatureRecord("freezer", saved.id, {
    ...actor,
    role: "SUPER_ADMIN",
  });
  const entry = tables.AUDIT_LOG.find(
    (row) => row[3] === "DELETE" && row[4] === saved.id,
  )!;
  const before = JSON.parse(String(entry[5]));
  expect(before.values).toEqual(saved.values);
  expect(before.deviceRefs).toEqual(saved.deviceRefs);
  expect(before.policyVersion).toBe(saved.policyVersion);
  expect(tables.TEMPERATURE_READINGS.slice(1)).toHaveLength(6);
  expect(await getRecords("freezer")).toEqual([]);
});
