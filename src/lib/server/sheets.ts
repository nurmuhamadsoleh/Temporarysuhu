import { isDeepStrictEqual } from "node:util";
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
  countRecordedStatuses,
  deviceInputSchema,
  type DeviceState,
  validateDeviceInputs,
  emptyDeviceInput,
  aggregateTemperatureStatus,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
import { AppError } from "./errors";
import { z } from "@/lib/validation";
import {
  defaultDevices,
  LEGACY_DEVICE_COUNTS,
  measurementRefs,
  measurementValue,
  MAX_DEVICE_NUMBER,
  MAX_MEASUREMENT_DEVICES,
  type TemperatureDeviceConfig,
} from "@/lib/devices";
import { USER_HEADERS } from "@/lib/users";
import { safeLog } from "./safe-log";
import { googleFetch } from "./google-transport";
import {
  validateDatabaseEnvironment,
  ConfigurationError,
} from "./runtime-config.mjs";
import { verifySignatureFile } from "./signature-integrity";
import type { SaveProgress } from "./save-diagnostics";
import {
  FeatureUnavailable,
  databaseUnavailable,
  googleFailureCode,
} from "./dependency-failure";
export const headers: Record<string, string[]> = {
  "Suhu Chiller": [
    "RECORD ID",
    "TANGGAL",
    "JAM",
    ...Array.from(
      { length: LEGACY_DEVICE_COUNTS.chiller },
      (_, i) => `SUHU CHILLER ${i + 1}`,
    ),
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
    ...Array.from(
      { length: LEGACY_DEVICE_COUNTS.freezer },
      (_, i) => `SUHU FREEZER ${i + 1}`,
    ),
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
  TEMPERATURE_DEVICES: [
    "DEVICE ID",
    "DEVICE TYPE",
    "DEVICE NUMBER",
    "LABEL",
    "ACTIVE",
    "CREATED AT",
    "UPDATED AT",
    "CREATED BY",
    "UPDATED BY",
  ],
  TEMPERATURE_READINGS: [
    "READING ID",
    "RECORD ID",
    "DEVICE TYPE",
    "DEVICE ID",
    "DEVICE NUMBER",
    "TEMPERATURE",
    "TEMPERATURE STATUS",
    "MISSING REASON",
    "CORRECTIVE ACTION",
    "PERFORMED BY",
    "ACTION STATUS",
    "ACTION ID",
    "POLICY VERSION",
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
  let config;
  try {
    config = validateDatabaseEnvironment();
  } catch (error) {
    throw databaseUnavailable(
      "DATABASE_CONFIG_INVALID",
      error instanceof ConfigurationError ? error.fields : [],
    );
  }
  const transport = { fetchImplementation: googleFetch, timeout: 15000 };
  return (client ??= google.sheets({
    version: "v4",
    ...transport,
    auth:
      config.authMode === "adc"
        ? new google.auth.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            clientOptions: { transporterOptions: transport },
          })
        : new google.auth.JWT({
            email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: config.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            transporterOptions: transport,
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
        throw databaseUnavailable(googleFailureCode(e));
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
    throw new FeatureUnavailable(
      googleFailureCode(error),
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
    const current = {
      ...policyBoundsSchema.parse(p.bounds),
      version: String(p.version),
    };
    // A pre-update null means no Freezer SOP was established. New explicit admin opt-outs remain valid.
    if (current.freezer === null && p.freezerPolicyExplicit !== true)
      return {
        ...current,
        freezer: DEFAULT_TEMPERATURE_POLICY.freezer,
        version:
          "freezer-brt-v1-" +
          createHash("sha256")
            .update(JSON.stringify(current))
            .digest("hex")
            .slice(0, 16),
      };
    return current;
  }
  const legacy = data.find((r) => r[0] === "SOP"),
    sop = legacy ? JSON.parse(String(legacy[1])) : null;
  const bounds = policyBoundsSchema.parse({
    chiller: DEFAULT_TEMPERATURE_POLICY.chiller,
    freezer: sop?.freezer
      ? { ...sop.freezer, warningMax: null }
      : DEFAULT_TEMPERATURE_POLICY.freezer,
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
    defaultsVersion: DEFAULT_TEMPERATURE_POLICY.version,
    freezerPolicyExplicit: true,
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
  const n = LEGACY_DEVICE_COUNTS[kind];
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
  const [metadata, readings] = await Promise.all([
    ids.TEMPERATURE_DEVICE_STATES === undefined
      ? []
      : rows("TEMPERATURE_DEVICE_STATES"),
    ids.TEMPERATURE_READINGS === undefined ? [] : rows("TEMPERATURE_READINGS"),
  ]);
  return data
    .slice(1)
    .filter((row) => row[0])
    .map((row) => {
      const r = decode(kind, row),
        meta = metadata.find((m) => m[0] === r.id && m[1] === kind),
        parts = readings.filter((p) => p[1] === r.id && p[2] === kind);
      if (parts.length && !meta)
        throw new AppError(
          409,
          "Manifest pembacaan perangkat hilang. Data dipertahankan untuk pemeriksaan integritas.",
        );
      if (meta) {
        if (String(meta[5]) !== r.updatedAt)
          throw new AppError(
            503,
            "Pengukuran sedang berubah. Muat ulang data.",
          );
        const state = JSON.parse(String(meta[2]));
        if (parts.length && state?.format !== "normalized-v1")
          throw new AppError(
            409,
            "Format manifest tidak sesuai pembacaan perangkat tersimpan.",
          );
        const legacyValues = [...r.values];
        r.policyVersion = String(meta[3]);
        r.policy = JSON.parse(String(meta[4]));
        if (state?.format === "normalized-v1") {
          const refs = z
            .array(
              z.object({
                id: z.string().min(1).max(100),
                number: z.number().int().min(1).max(MAX_DEVICE_NUMBER),
              }),
            )
            .min(1)
            .max(MAX_MEASUREMENT_DEVICES)
            .parse(state.devices);
          if (
            new Set(refs.map((d) => d.id)).size !== refs.length ||
            new Set(refs.map((d) => d.number)).size !== refs.length
          )
            throw new AppError(409, "Identitas pembacaan tersimpan duplikat");
          if (
            parts.length !== refs.length ||
            new Set(parts.map((p) => p[3])).size !== refs.length ||
            new Set(parts.map((p) => p[4])).size !== refs.length
          )
            throw new AppError(
              503,
              "Pembacaan perangkat belum lengkap atau duplikat. Coba kembali dengan kunci yang sama.",
            );
          r.deviceRefs = refs;
          r.values = [];
          r.deviceStates = [];
          for (const ref of refs) {
            const p = parts.find(
              (p) => p[3] === ref.id && Number(p[4]) === ref.number,
            );
            if (
              !p ||
              String(p[13]) !== r.updatedAt ||
              String(p[12]) !== r.policyVersion
            )
              throw new AppError(
                503,
                "Versi pembacaan perangkat belum konsisten.",
              );
            const value = p[5] === "" ? null : p[5];
            if (
              value !== null &&
              (typeof value !== "number" ||
                !Number.isFinite(value) ||
                Math.abs(value * 10 - Math.round(value * 10)) > 1e-7 ||
                value < config[kind].min ||
                value > config[kind].max)
            )
              throw new AppError(
                409,
                "Sel suhu perangkat bukan NUMBER dengan presisi yang sesuai.",
              );
            r.values.push(value === null ? null : normalize(value as number));
            const d = deviceInputSchema.parse({
              missingReason: String(p[7] || ""),
              correctiveAction: String(p[8] || ""),
              performedBy: String(p[9] || ""),
              actionStatus: String(p[10]),
            });
            r.deviceStates.push({
              ...d,
              deviceId: ref.id,
              deviceNumber: ref.number,
              temperatureStatus: String(
                p[6],
              ) as DeviceState["temperatureStatus"],
              ...(p[11] ? { actionId: String(p[11]) } : {}),
            });
          }
          if (
            legacyValues.some(
              (value, index) =>
                value !== (measurementValue(r, index + 1) ?? null),
            )
          )
            throw new AppError(
              409,
              "Kolom suhu legacy tidak cocok dengan pembacaan perangkat tersimpan.",
            );
        } else r.deviceStates = state;
        if (
          !Array.isArray(r.deviceStates) ||
          r.deviceStates.length !== r.values.length ||
          (!r.deviceRefs && r.values.length !== LEGACY_DEVICE_COUNTS[kind]) ||
          r.policy?.version !== r.policyVersion ||
          r.deviceStates.some(
            (d, i) =>
              d.deviceNumber !== (r.deviceRefs?.[i]?.number ?? i + 1) ||
              (r.deviceRefs && d.deviceId !== r.deviceRefs[i].id) ||
              d.temperatureStatus !==
                getTemperatureStatus(kind, r.values[i], r.policy!).code,
          )
        )
          throw new AppError(
            409,
            "Penilaian suhu tersimpan tidak cocok dengan pengukuran / versi SOP",
          );
      }
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
        .map(
          (e) =>
            kind +
            " " +
            (input.deviceRefs?.[e.deviceNumber - 1]?.number ?? e.deviceNumber) +
            ": " +
            e.message,
        )
        .join("; "),
    );
  return devices.map((d, i) => ({
    ...d,
    missingReason: input.values[i] === null ? d.missingReason : "",
    deviceNumber: input.deviceRefs?.[i]?.number ?? i + 1,
    ...(input.deviceRefs ? { deviceId: input.deviceRefs[i].id } : {}),
    temperatureStatus: getTemperatureStatus(kind, input.values[i], policy).code,
    ...(d.correctiveAction
      ? {
          actionId:
            before?.deviceStates?.find(
              (d) =>
                d.deviceNumber === (input.deviceRefs?.[i]?.number ?? i + 1),
            )?.actionId || crypto.randomUUID(),
        }
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
    JSON.stringify(
      record.deviceRefs
        ? { format: "normalized-v1", devices: record.deviceRefs }
        : record.deviceStates,
    ),
    record.policyVersion,
    JSON.stringify(record.policy),
    record.updatedAt,
  ];
  const requests = [
    index < 1
      ? append(ids.TEMPERATURE_DEVICE_STATES, row)
      : replace(ids.TEMPERATURE_DEVICE_STATES, index, row),
  ];
  if (record.deviceRefs) {
    const existing = await rows("TEMPERATURE_READINGS"),
      registry = await rows("TEMPERATURE_DEVICES");
    for (const device of [
      ...defaultDevices("chiller"),
      ...defaultDevices("freezer"),
    ])
      if (
        !registry.some(
          (row) => row[1] === device.kind && row[2] === device.number,
        )
      )
        requests.push(
          append(ids.TEMPERATURE_DEVICES, [
            device.id,
            device.kind,
            device.number,
            device.label,
            true,
            record.updatedAt,
            record.updatedAt,
            actor.id,
            actor.id,
          ]),
        );
    for (let i = 0; i < record.deviceRefs.length; i++) {
      const ref = record.deviceRefs[i],
        d = record.deviceStates![i],
        at = existing.findIndex(
          (p) => p[1] === record.id && p[2] === record.kind && p[3] === ref.id,
        );
      const reading = [
        at < 1 ? crypto.randomUUID() : existing[at][0],
        record.id,
        record.kind,
        ref.id,
        ref.number,
        record.values[i],
        d.temperatureStatus,
        d.missingReason,
        d.correctiveAction,
        d.performedBy,
        d.actionStatus,
        d.actionId || "",
        record.policyVersion,
        record.updatedAt,
      ];
      requests.push(
        at < 1
          ? append(ids.TEMPERATURE_READINGS, reading)
          : replace(ids.TEMPERATURE_READINGS, at, reading),
      );
    }
  }
  for (const d of record.deviceStates ?? []) {
    const previous = before?.deviceStates?.find(
      (p) => p.deviceNumber === d.deviceNumber,
    );
    if (
      !d.correctiveAction ||
      (previous &&
        before &&
        previous.correctiveAction === d.correctiveAction &&
        previous.performedBy === d.performedBy &&
        previous.actionStatus === d.actionStatus &&
        previous.temperatureStatus === d.temperatureStatus &&
        before.date === record.date &&
        before.time === record.time &&
        before.policyVersion === record.policyVersion &&
        (before ? measurementValue(before, d.deviceNumber) : undefined) ===
          measurementValue(record, d.deviceNumber))
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
        measurementValue(record, d.deviceNumber),
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
    ...Array.from(
      { length: LEGACY_DEVICE_COUNTS[r.kind] },
      (_, i) => measurementValue(r, i + 1) ?? null,
    ),
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
  progress: SaveProgress = () => {},
) {
  progress("sheets_read");
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
  await validateMeasurementDevices(kind, input);
  const signatures = await rows("SIGNATURE_METADATA");
  const signature = signatures.find(
    (r) => r[0] === input.signatureId && r[1] === actor.id && !r[2],
  );
  if (!signature)
    throw new AppError(400, "Tanda tangan tidak tersedia atau sudah digunakan");
  progress("storage");
  await verifySignatureFile(input.signatureId, signature);
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
  progress("sheets_write");
  await batch([
    append(ids[config[kind].sheet], encode(record)),
    replace(ids.SIGNATURE_METADATA, signatures.indexOf(signature), signature),
    audit(ids, actor, "CREATE", record.id, null, record, key, hash),
    ...(await deviceWriteRequests(record, actor, ids)),
  ]);
  progress("verification");
  const readBack = (await getRecords(kind)).find((r) => r.id === record.id);
  if (
    !readBack ||
    readBack.values.some((v, i) => v !== record.values[i]) ||
    !isDeepStrictEqual(readBack.deviceRefs, record.deviceRefs) ||
    !isDeepStrictEqual(readBack.deviceStates, record.deviceStates)
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
  progress: SaveProgress = () => {},
) {
  progress("sheets_read");
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
  await validateMeasurementDevices(kind, input, old);
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
  progress("sheets_write");
  await batch([
    replace(ids[config[kind].sheet], index, encode(next)),
    audit(ids, actor, "UPDATE", id, old, next),
    ...(await deviceWriteRequests(next, actor, ids, old)),
  ]);
  progress("verification");
  const confirmed = (await getRecords(kind)).find((r) => r.id === id);
  if (
    !confirmed ||
    confirmed.updatedAt !== next.updatedAt ||
    JSON.stringify(confirmed.values) !== JSON.stringify(next.values) ||
    !isDeepStrictEqual(confirmed.deviceStates, next.deviceStates) ||
    !isDeepStrictEqual(confirmed.deviceRefs, next.deviceRefs)
  )
    throw new FeatureUnavailable(
      "TEMPERATURE_PERSISTENCE_UNCONFIRMED",
      "Perubahan belum dapat dikonfirmasi. Periksa riwayat sebelum mencoba lagi.",
    );
  return confirmed;
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
  const before = (await getRecords(kind)).find((r) => r.id === id);
  if (!before) throw new AppError(404, "Record tidak ditemukan");
  if (await isLocked(id))
    throw new AppError(409, "Data terkunci oleh laporan yang disetujui");
  await batch([
    replace(
      ids[config[kind].sheet],
      index,
      Array(headers[config[kind].sheet].length).fill(""),
    ),
    audit(ids, actor, "DELETE", id, before, null),
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
  const freezerStatusCounts = countRecordedStatuses(freezer);
  return {
    freezerStatusCounts,
    chillerCount: chiller.length,
    freezerCount: freezer.length,
    chillerAverage: avg(chiller),
    freezerAverage: avg(freezer),
    alerts:
      freezerStatusCounts.WARNING +
      freezerStatusCounts.HIGH_TEMPERATURE +
      freezerStatusCounts.LOW_TEMPERATURE +
      chiller.reduce((n, r) => {
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

export type RegisteredDevice = TemperatureDeviceConfig & { version: string };
/** Read-only defaults until an authorized mutation persists the initial configuration. */
export async function getTemperatureDevices(
  includeInactive = false,
): Promise<RegisteredDevice[]> {
  const ids = await sheetIds(),
    data =
      ids.TEMPERATURE_DEVICES === undefined
        ? []
        : await rows("TEMPERATURE_DEVICES");
  const stored = data
    .slice(1)
    .filter((r) => r[0])
    .map((r) => {
      const kind = z.enum(["chiller", "freezer"]).parse(r[1]),
        number = z.number().int().min(1).max(MAX_DEVICE_NUMBER).parse(r[2]);
      if (
        !/^[a-zA-Z0-9-]{1,100}$/.test(String(r[0])) ||
        !["true", "false"].includes(String(r[4]))
      )
        throw new AppError(409, "Konfigurasi perangkat tidak valid");
      return {
        id: String(r[0]),
        kind,
        number,
        label: String(r[3]),
        active: r[4] === true || r[4] === "true",
        version: String(r[6]),
      };
    });
  if (
    new Set(stored.map((d) => d.id)).size !== stored.length ||
    new Set(stored.map((d) => d.kind + ":" + d.number)).size !== stored.length
  )
    throw new AppError(409, "Identitas/nomor perangkat duplikat");
  const defaults = [...defaultDevices("chiller"), ...defaultDevices("freezer")];
  for (const d of defaults) {
    const match = stored.find(
      (s) => s.kind === d.kind && s.number === d.number,
    );
    // Chiller 6 may already have been registered with its own stable ID.
    if (match && match.id !== d.id && !(d.kind === "chiller" && d.number === 6))
      throw new AppError(409, "Identitas perangkat bawaan tidak boleh diganti");
  }
  const all = [
    ...stored,
    ...defaults
      .filter(
        (d) => !stored.some((s) => s.kind === d.kind && s.number === d.number),
      )
      .map((d) => ({ ...d, version: "initial-v1" })),
  ];
  return all
    .filter((d) => includeInactive || d.active)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number);
}
async function validateMeasurementDevices(
  kind: Kind,
  input: MeasurementInput,
  before?: Measurement,
) {
  if (!input.deviceRefs && before?.deviceRefs)
    throw new AppError(
      409,
      "Pengukuran dinamis wajib mempertahankan identitas seluruh perangkat saat diedit.",
    );
  const requested =
    input.deviceRefs ?? measurementRefs({ kind, values: input.values });
  const known = await getTemperatureDevices(true),
    previous = before ? measurementRefs(before) : [];
  if (before && JSON.stringify(requested) !== JSON.stringify(previous))
    throw new AppError(
      409,
      "Perangkat pada pengukuran historis tidak boleh ditukar atau dihapus. Buat pengukuran baru.",
    );
  for (const ref of requested) {
    const d = known.find(
      (d) => d.id === ref.id && d.kind === kind && d.number === ref.number,
    );
    if (!d || (!d.active && !previous.some((p) => p.id === d.id)))
      throw new AppError(
        400,
        "Perangkat tidak terdaftar/aktif. Muat ulang daftar perangkat tanpa menghapus isian.",
      );
  }
  if (
    !before &&
    input.deviceRefs &&
    known.some(
      (d) =>
        d.kind === kind &&
        d.active &&
        !input.deviceRefs!.some((ref) => ref.id === d.id),
    )
  )
    throw new AppError(
      409,
      "Daftar perangkat aktif berubah. Muat ulang konfigurasi dan lengkapi pengukuran.",
    );
}
export async function registerTemperatureDevice(
  kind: Kind,
  id: string,
  actor: Actor,
  expectedNumber?: number,
) {
  if (actor.role !== "SUPER_ADMIN")
    throw new AppError(
      403,
      "Hanya Super Admin dapat menambah perangkat permanen",
    );
  z.uuid().parse(id);
  const all = await getTemperatureDevices(true),
    ids = await ensureSheetHeaders(["TEMPERATURE_DEVICES", "AUDIT_LOG"]),
    data = await rows("TEMPERATURE_DEVICES");
  const existing = data.find((r) => r[0] === id);
  if (existing) {
    if (existing[1] !== kind || existing[7] !== actor.id)
      throw new AppError(409, "Kunci perangkat sudah digunakan");
    return all.find((d) => d.id === id)!;
  }
  if (
    all.filter((d) => d.kind === kind && d.active).length >=
    MAX_MEASUREMENT_DEVICES
  )
    throw new AppError(400, "Batas jumlah perangkat aktif tercapai");
  const number =
    Math.max(0, ...all.filter((d) => d.kind === kind).map((d) => d.number)) + 1;
  if (expectedNumber !== undefined && expectedNumber !== number)
    throw new AppError(
      409,
      "Nomor perangkat berubah. Muat ulang daftar sebelum mendaftarkan perangkat ini.",
    );
  if (number > MAX_DEVICE_NUMBER)
    throw new AppError(400, "Nomor perangkat maksimum tercapai");
  const now = new Date().toISOString(),
    next = {
      id,
      kind,
      number,
      label: config[kind].label + " " + number,
      active: true,
      version: now,
    };
  const seeds = all
    .filter((d) => !data.some((r) => r[0] === d.id))
    .map((d) =>
      append(ids.TEMPERATURE_DEVICES, [
        d.id,
        d.kind,
        d.number,
        d.label,
        d.active,
        now,
        now,
        actor.id,
        actor.id,
      ]),
    );
  await batch([
    ...seeds,
    append(ids.TEMPERATURE_DEVICES, [
      id,
      kind,
      number,
      next.label,
      true,
      now,
      now,
      actor.id,
      actor.id,
    ]),
    audit(ids, actor, "REGISTER_TEMPERATURE_DEVICE", id, null, next, id, kind),
  ]);
  const confirmed = (await getTemperatureDevices(true)).find(
    (d) => d.id === id,
  );
  if (!confirmed)
    throw new AppError(
      503,
      "Pendaftaran perangkat belum dapat dikonfirmasi. Coba kembali dengan input yang sama.",
    );
  return confirmed;
}
export async function setTemperatureDeviceActive(
  id: string,
  active: boolean,
  version: string,
  actor: Actor,
) {
  if (actor.role !== "SUPER_ADMIN")
    throw new AppError(
      403,
      "Hanya Super Admin dapat mengubah konfigurasi perangkat",
    );
  const all = await getTemperatureDevices(true),
    old = all.find((d) => d.id === id);
  if (!old) throw new AppError(404, "Perangkat tidak ditemukan");
  if (old.active === active) return old;
  if (old.version !== version)
    throw new AppError(409, "Konfigurasi perangkat berubah. Muat ulang.");
  if (
    active &&
    all.filter((d) => d.kind === old.kind && d.active).length >=
      MAX_MEASUREMENT_DEVICES
  )
    throw new AppError(400, "Batas jumlah perangkat aktif tercapai");
  const ids = await ensureSheetHeaders(["TEMPERATURE_DEVICES", "AUDIT_LOG"]),
    data = await rows("TEMPERATURE_DEVICES"),
    index = data.findIndex((r) => r[0] === id),
    now = new Date(
      Math.max(
        Date.now(),
        Number.isFinite(Date.parse(old.version))
          ? Date.parse(old.version) + 1
          : 0,
      ),
    ).toISOString();
  const row = [
    id,
    old.kind,
    old.number,
    old.label,
    active,
    index < 1 ? now : data[index][5],
    now,
    index < 1 ? actor.id : data[index][7],
    actor.id,
  ];
  await batch([
    index < 1
      ? append(ids.TEMPERATURE_DEVICES, row)
      : replace(ids.TEMPERATURE_DEVICES, index, row),
    audit(
      ids,
      actor,
      active ? "ACTIVATE_TEMPERATURE_DEVICE" : "DEACTIVATE_TEMPERATURE_DEVICE",
      id,
      old,
      { ...old, active, version: now },
    ),
  ]);
  const confirmed = (await getTemperatureDevices(true)).find(
    (d) => d.id === id,
  );
  if (!confirmed || confirmed.active !== active)
    throw new AppError(503, "Perubahan perangkat belum dapat dikonfirmasi");
  return confirmed;
}
