import "server-only";
import { createHash } from "node:crypto";
import { google, sheets_v4 } from "googleapis";
import {
  config,
  type Kind,
  type Actor,
  type Measurement,
  type MeasurementInput,
  type Sop,
  normalize,
} from "@/lib/domain";
import {
  DEFAULT_TEMPERATURE_POLICY,
  policyBoundsSchema,
  getTemperatureStatus,
  validateDeviceInputs,
  emptyDeviceInput,
  aggregateTemperatureStatus,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
import { AppError } from "./errors";
import { USER_HEADERS } from "@/lib/users";
import { safeLog } from "./safe-log";
import { googleFetch } from "./google-transport";
export const headers: Record<string, string[]> = {
  "Suhu Chiller": [
    "RECORD ID",
    "TANGGAL",
    "JAM",
    ...Array.from({ length: 5 }, (_, i) => `SUHU CHILLER ${i + 1}`),
    "NAMA PETUGAS",
    "TANDA TANGAN",
    "STATUS",
    "KETERANGAN",
    "CREATED AT",
    "UPDATED AT",
    "CREATED BY",
    "UPDATED BY",
  ],
  "Suhu Freezer": [
    "RECORD ID",
    "TANGGAL",
    "JAM",
    ...Array.from({ length: 4 }, (_, i) => `SUHU FREEZER ${i + 1}`),
    "NAMA PETUGAS",
    "TANDA TANGAN",
    "STATUS",
    "KETERANGAN",
    "CREATED AT",
    "UPDATED AT",
    "CREATED BY",
    "UPDATED BY",
  ],
  AUDIT_LOG: [
    "ID",
    "AT",
    "ACTOR",
    "ACTION",
    "ENTITY",
    "BEFORE",
    "AFTER",
    "IDEMPOTENCY KEY",
    "REQUEST HASH",
  ],
  APP_USERS: USER_HEADERS,
  SIGNATURE_METADATA: [
    "ID",
    "OWNER ID",
    "RECORD ID",
    "SIGNED AT",
    "FILE",
    "SHA256",
  ],
  APP_CONFIG: ["KEY", "VALUE"],
  TEMPERATURE_REPORT_CONFIG: ["KEY", "VALUE", "UPDATED AT", "UPDATED BY"],
  TEMPERATURE_REPORT_VERIFICATIONS: [
    "REPORT ID",
    "VERIFIED BY USER ID",
    "VERIFIED AT",
    "VERIFICATION STATUS",
    "SIGNATURE REFERENCE",
    "SOURCE HASH",
    "INVALIDATED AT",
    "VERIFIER NAME",
  ],
  TEMPERATURE_CORRECTIVE_ACTIONS: [
    "ACTION ID",
    "RECORD ID",
    "DEVICE TYPE",
    "DEVICE NUMBER",
    "DATE",
    "TIME",
    "DESCRIPTION",
    "PERFORMED BY",
    "VERIFICATION STATUS",
    "VERIFIED BY",
    "VERIFIED AT",
    "CREATED AT",
    "UPDATED AT",
    "PERFORMER NAME",
    "VERIFIER NAME",
    "TEMPERATURE",
    "TEMPERATURE STATUS",
    "STATUS TINDAKAN",
    "CREATED BY",
    "UPDATED BY",
    "SOP VERSION",
  ],
  TEMPERATURE_DEVICE_STATES: [
    "RECORD ID",
    "DEVICE TYPE",
    "DEVICE STATES",
    "POLICY VERSION",
    "POLICY SNAPSHOT",
    "UPDATED AT",
  ],
  REPORTS: [
    "ID",
    "CREATED AT",
    "CREATED BY",
    "SNAPSHOT FILE",
    "STATUS",
    "APPROVED BY",
    "APPROVED AT",
    "SIGNED FILE",
    "SHA256",
    "REVISION OF",
    "APPROVER SIGNATURE",
  ],
};
let client: sheets_v4.Sheets;
export function getSpreadsheetClient() {
  if (
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY ||
    !process.env.GOOGLE_SPREADSHEET_ID
  )
    throw new AppError(
      503,
      "Google Sheets belum dikonfigurasi. Isi service account dan bagikan spreadsheet kepada service account.",
    );
  return (client ??= google.sheets({
    version: "v4",
    fetchImplementation: googleFetch,
    auth: new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      transporterOptions: { fetchImplementation: googleFetch },
    }),
  }));
}
const spreadsheetId = () => process.env.GOOGLE_SPREADSHEET_ID!;
export async function retryRead<T>(fn: () => Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      const code = Number((e as { code?: unknown }).code);
      if (n >= 3 || ![429, 500, 502, 503, 504].includes(code)) {
        if (e instanceof AppError) throw e;
        safeLog(
          "sheets_check_failed",
          `SHEETS_API_${Number.isFinite(code) ? code : "ERROR"}`,
        );
        throw new AppError(
          503,
          "Google Sheets tidak dapat diakses. Periksa konfigurasi dan izin service account.",
        );
      }
      await new Promise((r) =>
        setTimeout(r, 250 * 2 ** n + Math.random() * 100),
      );
    }
  }
}
export async function rows(
  sheet: string,
): Promise<(string | number | boolean)[][]> {
  const r = await retryRead(() =>
    getSpreadsheetClient().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `'${sheet}'!A:AZ`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    }),
  );
  return r.data.values || [];
}
export const cells = (row: unknown[]) =>
  row.map((v) =>
    v === null
      ? {}
      : {
          userEnteredValue:
            typeof v === "number"
              ? { numberValue: v }
              : { stringValue: String(v ?? "") },
        },
  );
export async function sheetIds() {
  const s = await retryRead(() =>
    getSpreadsheetClient().spreadsheets.get({
      spreadsheetId: spreadsheetId(),
      fields: "sheets.properties",
    }),
  );
  return Object.fromEntries(
    s.data.sheets!.map((s) => [s.properties!.title!, s.properties!.sheetId!]),
  );
}
export async function batch(requests: sheets_v4.Schema$Request[]) {
  try {
    await getSpreadsheetClient().spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { requests },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    safeLog("sheets_check_failed", "SHEETS_WRITE_FAILED");
    throw new AppError(
      503,
      "Penulisan Google Sheets belum dapat dikonfirmasi. Coba kembali dengan idempotency key yang sama bila tersedia.",
    );
  }
}
export async function ensureSheetHeaders(names = Object.keys(headers)) {
  let ids = await sheetIds();
  for (const name of names) {
    const expected = headers[name];
    if (!expected) throw new AppError(400, "Schema sheet tidak dikenal");
    if (ids[name] === undefined) {
      await batch([{ addSheet: { properties: { title: name } } }]);
      ids = await sheetIds();
    }
    const data = await rows(name);
    if (!data.length || data.every((r) => r.every((c) => c === ""))) {
      await batch([
        {
          updateCells: {
            range: {
              sheetId: ids[name],
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: expected.length,
            },
            rows: [{ values: cells(expected) }],
            fields: "userEnteredValue",
          },
        },
      ]);
    } else if (
      name === "TEMPERATURE_CORRECTIVE_ACTIONS" &&
      data[0].length === 15 &&
      data[0].every((v, i) => v === expected[i])
    ) {
      await batch([
        {
          updateCells: {
            range: {
              sheetId: ids[name],
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 15,
              endColumnIndex: expected.length,
            },
            rows: [{ values: cells(expected.slice(15)) }],
            fields: "userEnteredValue",
          },
        },
      ]);
    } else if (expected.some((v, i) => data[0][i] !== v)) {
      throw new AppError(
        409,
        `Header sheet ${name} tidak cocok. Data dipertahankan; migrasi perlu ditinjau administrator.`,
      );
    }
  }
  return ids;
}
export const append = (
  sheetId: number,
  row: unknown[],
): sheets_v4.Schema$Request => ({
  appendCells: {
    sheetId,
    rows: [{ values: cells(row) }],
    fields: "userEnteredValue",
  },
});
export const replace = (
  sheetId: number,
  index: number,
  row: unknown[],
): sheets_v4.Schema$Request => ({
  updateCells: {
    range: {
      sheetId,
      startRowIndex: index,
      endRowIndex: index + 1,
      startColumnIndex: 0,
      endColumnIndex: row.length,
    },
    rows: [{ values: cells(row) }],
    fields: "userEnteredValue",
  },
});
export function audit(
  ids: Record<string, number>,
  actor: Actor,
  action: string,
  entity: string,
  before: unknown,
  after: unknown,
  key = "",
  hash = "",
) {
  return append(ids.AUDIT_LOG, [
    crypto.randomUUID(),
    new Date().toISOString(),
    actor.id,
    action,
    entity,
    JSON.stringify(before),
    JSON.stringify(after),
    key,
    hash,
  ]);
}
export async function getTemperaturePolicy(): Promise<TemperaturePolicy> {
  const data = await rows("APP_CONFIG"),
    configured = data.find((r) => r[0] === "TEMPERATURE_POLICY");
  if (configured) {
    const p = JSON.parse(String(configured[1]));
    if (typeof p.version !== "string" || !p.version)
      throw new AppError(409, "Versi SOP tersimpan tidak valid");
    return {
      ...policyBoundsSchema.parse(p.bounds),
      version: String(p.version),
    };
  }
  const legacy = data.find((r) => r[0] === "SOP"),
    sop = legacy ? JSON.parse(String(legacy[1])) : null;
  const bounds = policyBoundsSchema.parse({
    chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
    freezer: sop?.freezer ? { ...sop.freezer, warningMax: null } : null,
  });
  return {
    ...bounds,
    version: sop?.freezer
      ? "legacy-freezer-" +
        createHash("sha256")
          .update(JSON.stringify(bounds))
          .digest("hex")
          .slice(0, 16)
      : DEFAULT_TEMPERATURE_POLICY.version,
  };
}
export async function getSop(): Promise<Sop> {
  const p = await getTemperaturePolicy();
  return {
    chiller: p.chiller ? { min: p.chiller.min, max: p.chiller.max } : null,
    freezer: p.freezer ? { min: p.freezer.min, max: p.freezer.max } : null,
  };
}
export async function saveTemperaturePolicy(
  bounds: unknown,
  version: string,
  actor: Actor,
) {
  if (actor.role !== "SUPER_ADMIN")
    throw new AppError(403, "Hanya Super Admin dapat mengelola SOP");
  const next = policyBoundsSchema.parse(bounds),
    before = await getTemperaturePolicy();
  if (before.version !== version)
    throw new AppError(409, "SOP telah berubah. Muat ulang.");
  const ids = await ensureSheetHeaders(),
    data = await rows("APP_CONFIG"),
    index = data.findIndex((r) => r[0] === "TEMPERATURE_POLICY");
  const policy = {
    bounds: next,
    version: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.id,
  };
  const row = ["TEMPERATURE_POLICY", JSON.stringify(policy)];
  await batch([
    index < 1
      ? append(ids.APP_CONFIG, row)
      : replace(ids.APP_CONFIG, index, row),
    audit(
      ids,
      actor,
      "CONFIGURE_TEMPERATURE_POLICY",
      "TEMPERATURE_POLICY",
      before,
      policy,
    ),
  ]);
  return { ...next, version: policy.version };
}
export function decode(
  kind: Kind,
  r: (string | number | boolean)[],
): Measurement {
  const n = config[kind].count;
  const values = r.slice(3, 3 + n).map((v) => {
    if (v === "" || v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new AppError(
        409,
        "Sel suhu bukan NUMBER. Periksa format dan locale spreadsheet.",
      );
    return normalize(v);
  });
  return {
    id: String(r[0]),
    kind,
    date: String(r[1]),
    time: String(r[2]),
    values,
    officer: String(r[3 + n]),
    signatureId: String(r[4 + n]),
    status: String(r[5 + n]),
    notes: String(r[6 + n] || ""),
    createdAt: String(r[7 + n]),
    updatedAt: String(r[8 + n]),
    version: String(r[8 + n]),
    createdBy: String(r[9 + n]),
    updatedBy: String(r[10 + n]),
  };
}
export async function getChillerRecords() {
  return getRecords("chiller");
}
export async function getFreezerRecords() {
  return getRecords("freezer");
}
export async function getRecords(kind: Kind) {
  const [data, ids] = await Promise.all([rows(config[kind].sheet), sheetIds()]);
  const metadata =
    ids.TEMPERATURE_DEVICE_STATES === undefined
      ? []
      : await rows("TEMPERATURE_DEVICE_STATES");
  return data
    .slice(1)
    .filter((r) => r[0])
    .map((row) => {
      const r = decode(kind, row),
        meta = metadata.find((m) => m[0] === r.id && m[1] === kind);
      if (meta) {
        if (String(meta[5]) !== r.updatedAt)
          throw new AppError(
            503,
            "Pengukuran sedang berubah. Muat ulang data.",
          );
        r.deviceStates = JSON.parse(String(meta[2]));
        r.policyVersion = String(meta[3]);
        r.policy = JSON.parse(String(meta[4]));
        if (
          !Array.isArray(r.deviceStates) ||
          r.deviceStates.length !== config[kind].count ||
          r.policy?.version !== r.policyVersion ||
          r.deviceStates.some(
            (d, i) =>
              d.deviceNumber !== i + 1 ||
              d.temperatureStatus !==
                getTemperatureStatus(kind, r.values[i], r.policy!).code,
          )
        )
          throw new AppError(
            409,
            "Penilaian suhu tersimpan tidak cocok dengan pengukuran / versi SOP",
          );
      }
      if (
        r.values.some(
          (v, i) => v === null && !r.deviceStates?.[i]?.missingReason,
        )
      )
        throw new AppError(
          409,
          "Suhu kosong tanpa alasan tersimpan. Periksa integritas pengukuran.",
        );
      return r;
    });
}
function prepareDeviceState(
  input: MeasurementInput,
  kind: Kind,
  policy: TemperaturePolicy,
  before?: Measurement,
) {
  if (input.policyVersion && input.policyVersion !== policy.version)
    throw new AppError(
      409,
      "Versi SOP berubah. Muat ulang kebijakan suhu sebelum menyimpan.",
    );
  const devices = input.devices ?? input.values.map(emptyDeviceInput),
    errors = validateDeviceInputs(kind, input.values, devices, policy);
  if (errors.length)
    throw new AppError(
      400,
      errors
        .map((e) => kind + " " + e.deviceNumber + ": " + e.message)
        .join("; "),
    );
  return devices.map((d, i) => ({
    ...d,
    missingReason: input.values[i] === null ? d.missingReason : "",
    deviceNumber: i + 1,
    temperatureStatus: getTemperatureStatus(kind, input.values[i], policy).code,
    ...(d.correctiveAction
      ? { actionId: before?.deviceStates?.[i]?.actionId || crypto.randomUUID() }
      : {}),
  }));
}
async function deviceWriteRequests(
  record: Measurement,
  actor: Actor,
  ids: Record<string, number>,
  before?: Measurement,
) {
  const data = await rows("TEMPERATURE_DEVICE_STATES"),
    index = data.findIndex((r) => r[0] === record.id && r[1] === record.kind);
  const actions = await rows("TEMPERATURE_CORRECTIVE_ACTIONS");
  const row = [
    record.id,
    record.kind,
    JSON.stringify(record.deviceStates),
    record.policyVersion,
    JSON.stringify(record.policy),
    record.updatedAt,
  ];
  const requests = [
    index < 1
      ? append(ids.TEMPERATURE_DEVICE_STATES, row)
      : replace(ids.TEMPERATURE_DEVICE_STATES, index, row),
  ];
  for (const d of record.deviceStates ?? []) {
    const previous = before?.deviceStates?.[d.deviceNumber - 1];
    if (
      !d.correctiveAction ||
      (previous &&
        previous.correctiveAction === d.correctiveAction &&
        previous.performedBy === d.performedBy &&
        previous.actionStatus === d.actionStatus &&
        previous.temperatureStatus === d.temperatureStatus &&
        before.date === record.date &&
        before.time === record.time &&
        before.policyVersion === record.policyVersion &&
        before?.values[d.deviceNumber - 1] ===
          record.values[d.deviceNumber - 1])
    )
      continue;
    const actionId = d.actionId!,
      actionIndex = actions.findIndex((r) => r[0] === actionId),
      oldAction = actionIndex < 1 ? null : actions[actionIndex],
      a = [
        actionId,
        record.id,
        record.kind.toUpperCase(),
        d.deviceNumber,
        record.date,
        record.time,
        d.correctiveAction,
        oldAction?.[7] || actor.id,
        "PENDING",
        "",
        "",
        oldAction?.[11] || record.updatedAt,
        record.updatedAt,
        d.performedBy,
        "",
        record.values[d.deviceNumber - 1],
        d.temperatureStatus,
        d.actionStatus,
        oldAction?.[18] || actor.id,
        actor.id,
        record.policyVersion,
      ];
    requests.push(
      actionIndex < 1
        ? append(ids.TEMPERATURE_CORRECTIVE_ACTIONS, a)
        : replace(ids.TEMPERATURE_CORRECTIVE_ACTIONS, actionIndex, a),
      audit(
        ids,
        actor,
        actionIndex < 1
          ? "CREATE_TEMPERATURE_CORRECTION"
          : "UPDATE_TEMPERATURE_CORRECTION",
        actionId,
        oldAction,
        a,
      ),
    );
  }
  return requests;
}
export async function allRecords() {
  return [...(await getChillerRecords()), ...(await getFreezerRecords())];
}
export function encode(r: Measurement) {
  return [
    r.id,
    r.date,
    r.time,
    ...r.values,
    r.officer,
    r.signatureId,
    r.status,
    r.notes,
    r.createdAt,
    r.updatedAt,
    r.createdBy,
    r.updatedBy,
  ];
}
export async function isLocked(id: string) {
  for (const row of (await rows("REPORTS")).slice(1)) {
    if (["APPROVED", "SIGNED"].includes(String(row[4]))) {
      const { getFile } = await import("./storage");
      const snapshot = JSON.parse(
        (await getFile(String(row[3]))).toString(),
      ) as { records: Measurement[] };
      if (snapshot.records.some((r) => r.id === id)) return true;
    }
  }
  return false;
}
export async function createTemperatureRecord(
  kind: Kind,
  input: MeasurementInput,
  actor: Actor,
  key: string,
  hash: string,
) {
  const ids = await ensureSheetHeaders();
  const existing = (await rows("AUDIT_LOG")).find(
    (r) => r[7] === key && r[2] === actor.id,
  );
  if (existing) {
    if (existing[8] !== hash)
      throw new AppError(
        409,
        "Idempotency key sudah dipakai untuk payload lain",
      );
    const found = await getRecords(kind);
    const r = found.find((r) => r.id === existing[4]);
    if (!r) throw new AppError(409, "Request sebelumnya sudah diproses");
    return r;
  }
  const signatures = await rows("SIGNATURE_METADATA");
  const signature = signatures.find(
    (r) => r[0] === input.signatureId && r[1] === actor.id && !r[2],
  );
  if (!signature)
    throw new AppError(400, "Tanda tangan tidak tersedia atau sudah digunakan");
  const policy = await getTemperaturePolicy(),
    deviceStates = prepareDeviceState(input, kind, policy);
  const now = new Date().toISOString();
  const record: Measurement = {
    ...input,
    id: crypto.randomUUID(),
    kind,
    officer: actor.name,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: now,
    updatedAt: now,
    version: now,
    values: input.values.map((v) => (v === null ? null : normalize(v))),
    deviceStates,
    policy,
    policyVersion: policy.version,
    status: aggregateTemperatureStatus(deviceStates),
  };
  signature[2] = record.id;
  await batch([
    append(ids[config[kind].sheet], encode(record)),
    replace(ids.SIGNATURE_METADATA, signatures.indexOf(signature), signature),
    audit(ids, actor, "CREATE", record.id, null, record, key, hash),
    ...(await deviceWriteRequests(record, actor, ids)),
  ]);
  const readBack = (await getRecords(kind)).find((r) => r.id === record.id);
  if (
    !readBack ||
    readBack.values.some((v, i) => v !== record.values[i]) ||
    JSON.stringify(readBack.deviceStates) !==
      JSON.stringify(record.deviceStates)
  )
    throw new AppError(
      503,
      "Data belum terverifikasi. Ulangi request dengan idempotency key yang sama.",
    );
  return readBack;
}
export async function updateTemperatureRecord(
  kind: Kind,
  id: string,
  input: MeasurementInput,
  actor: Actor,
) {
  const ids = await ensureSheetHeaders();
  const data = await rows(config[kind].sheet);
  const index = data.findIndex((r) => r[0] === id);
  if (index < 1) throw new AppError(404, "Record tidak ditemukan");
  const old = (await getRecords(kind)).find((r) => r.id === id)!;
  if (
    actor.role === "SUPERVISOR" ||
    (actor.role === "PETUGAS" && old.createdBy !== actor.id)
  )
    throw new AppError(403, "Tidak memiliki izin edit");
  if (await isLocked(id))
    throw new AppError(
      409,
      "Data telah disetujui dan terkunci. Buat pengukuran/revisi baru.",
    );
  if (input.version !== old.updatedAt)
    throw new AppError(409, "Data sudah berubah. Muat ulang sebelum mengedit.");
  if (input.signatureId !== old.signatureId)
    throw new AppError(400, "Referensi tanda tangan tidak boleh diganti");
  const policy = await getTemperaturePolicy(),
    deviceStates = prepareDeviceState(input, kind, policy, old);
  const next = {
    ...old,
    ...input,
    values: input.values.map((v) => (v === null ? null : normalize(v))),
    updatedAt: new Date(
      Math.max(Date.now(), Date.parse(old.updatedAt) + 1),
    ).toISOString(),
    updatedBy: actor.id,
    deviceStates,
    policy,
    policyVersion: policy.version,
    status: aggregateTemperatureStatus(deviceStates),
  };
  await batch([
    replace(ids[config[kind].sheet], index, encode(next)),
    audit(ids, actor, "UPDATE", id, old, next),
    ...(await deviceWriteRequests(next, actor, ids, old)),
  ]);
  return next;
}
export async function deleteTemperatureRecord(
  kind: Kind,
  id: string,
  actor: Actor,
) {
  if (!["ADMIN", "SUPER_ADMIN"].includes(actor.role))
    throw new AppError(403, "Hanya administrator");
  const ids = await ensureSheetHeaders();
  const data = await rows(config[kind].sheet);
  const index = data.findIndex((r) => r[0] === id);
  if (index < 1) throw new AppError(404, "Record tidak ditemukan");
  if (await isLocked(id))
    throw new AppError(409, "Data terkunci oleh laporan yang disetujui");
  await batch([
    replace(
      ids[config[kind].sheet],
      index,
      Array(headers[config[kind].sheet].length).fill(""),
    ),
    audit(ids, actor, "DELETE", id, decode(kind, data[index]), null),
  ]);
}
export function getTemperatureStatistics(records: Measurement[], sop: Sop) {
  const chiller = records.filter((r) => r.kind === "chiller"),
    freezer = records.filter((r) => r.kind === "freezer");
  const avg = (r: Measurement[]) => {
    const values = r
      .flatMap((r) => r.values)
      .filter((v): v is number => v !== null);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };
  return {
    chillerCount: chiller.length,
    freezerCount: freezer.length,
    chillerAverage: avg(chiller),
    freezerAverage: avg(freezer),
    alerts: records.reduce((n, r) => {
      const bound = sop[r.kind];
      return (
        n +
        (bound
          ? r.values.filter(
              (v) => v !== null && (v < bound.min || v > bound.max),
            ).length
          : 0)
      );
    }, 0),
  };
}
export const getMonitoringReport = allRecords;
