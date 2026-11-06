import {
  MAX_DEVICE_NUMBER,
  measurementIndex,
  measurementValue,
} from "@/lib/devices";
import "server-only";
import { createHash } from "node:crypto";
import {
  append,
  audit,
  batch,
  ensureSheetHeaders,
  getRecords,
  getSop,
  replace,
  rows,
} from "./sheets";
import { AppError } from "./errors";
import {
  dateSchema,
  type Actor,
  type Kind,
  type Measurement,
} from "@/lib/domain";
import {
  defaultReportConfig,
  reportConfigSchema,
  normalizeReadings,
  selectControlRecords,
  makeControlPages,
  reportDates,
  type ReportConfig,
  type ControlFilter,
  type TemperatureReport,
  type TemperatureCorrection,
  type TemperatureVerification,
  type correctionInputSchema,
} from "@/lib/temperature-report/model";
import { z } from "zod";
const CONFIG = "TEMPERATURE_REPORT_CONFIG",
  ACTIONS = "TEMPERATURE_CORRECTIVE_ACTIONS",
  VERIFY = "TEMPERATURE_REPORT_VERIFICATIONS";
export async function controlSettings() {
  await ensureSheetHeaders();
  const row = (await rows(CONFIG)).find((r) => r[0] === "control");
  return {
    settings: row
      ? reportConfigSchema.parse(JSON.parse(String(row[1])))
      : defaultReportConfig,
    version: row ? String(row[2]) : "unconfigured",
  };
}
export async function saveControlSettings(
  settings: ReportConfig,
  version: string,
  actor: Actor,
) {
  if (!["ADMIN", "SUPER_ADMIN"].includes(actor.role))
    throw new AppError(403, "Akses pengaturan ditolak");
  const ids = await ensureSheetHeaders(),
    data = await rows(CONFIG),
    index = data.findIndex((r) => r[0] === "control");
  const before = index < 0 ? null : data[index];
  if ((before ? String(before[2]) : "unconfigured") !== version)
    throw new AppError(409, "Konfigurasi telah berubah. Muat ulang.");
  const row = [
    "control",
    JSON.stringify(settings),
    new Date().toISOString(),
    actor.id,
  ];
  await batch([
    index < 0 ? append(ids[CONFIG], row) : replace(ids[CONFIG], index, row),
    audit(ids, actor, "UPDATE_CONTROL_REPORT_CONFIG", "control", before, row),
  ]);
  return { settings, version: row[2] };
}
export function decodeCorrection(
  r: (string | number | boolean | null)[],
): TemperatureCorrection {
  return {
    id: String(r[0]),
    recordId: String(r[1]),
    deviceType: String(
      r[2],
    ).toLowerCase() as TemperatureCorrection["deviceType"],
    deviceNumber: Number(r[3]),
    date: String(r[4]),
    time: String(r[5]),
    description: String(r[6]),
    performedBy: String(r[7]),
    verificationStatus: String(
      r[8],
    ) as TemperatureCorrection["verificationStatus"],
    verifiedBy: String(r[9] || ""),
    verifiedAt: String(r[10] || ""),
    createdAt: String(r[11]),
    updatedAt: String(r[12]),
    performedByName: String(r[13] || r[7]),
    verifiedByName: String(r[14] || ""),
    ...(r[17]
      ? {
          actionStatus: String(r[17]) as TemperatureCorrection["actionStatus"],
          temperatureCelsius: typeof r[15] === "number" ? r[15] : null,
          temperatureStatus: String(r[16] || ""),
          policyVersion: String(r[20] || ""),
          performerIsManual: true,
        }
      : {}),
  };
}
export async function getCorrections() {
  return (await rows(ACTIONS))
    .slice(1)
    .filter((r) => r[0])
    .map(decodeCorrection);
}
export type CorrectiveActionReportQuery = {
  deviceType: Kind;
  deviceNumber: number;
  startDate: string;
  endDate: string;
};
export type CorrectiveActionForReport = {
  actionId: string;
  recordId: string;
  deviceType: Kind;
  deviceNumber: number;
  measurementDate: string;
  measurementTime: string;
  correctiveAction: string;
  performedBy: string;
  actionStatus: TemperatureCorrection["actionStatus"];
  verificationStatus: TemperatureCorrection["verificationStatus"];
  verifiedBy: string;
  verifiedAt: string;
  source: TemperatureCorrection;
};
export async function getCorrectiveActionsForReport(
  query: CorrectiveActionReportQuery,
  sources?: { records: Measurement[]; actions: TemperatureCorrection[] },
): Promise<CorrectiveActionForReport[]> {
  const q = z
    .object({
      deviceType: z.enum(["chiller", "freezer"]),
      deviceNumber: z.number().int().min(1).max(MAX_DEVICE_NUMBER),
      startDate: dateSchema,
      endDate: dateSchema,
    })
    .strict()
    .refine(
      (q) => q.startDate <= q.endDate,
      "Filter perangkat/periode tidak valid",
    )
    .parse(query);
  const [records, actions] = sources
    ? [sources.records, sources.actions]
    : await Promise.all([getRecords(q.deviceType), getCorrections()]);
  const selected = new Map(
    records
      .filter(
        (r) =>
          r.kind === q.deviceType &&
          r.date >= q.startDate &&
          r.date <= q.endDate &&
          measurementIndex(r, q.deviceNumber) >= 0,
      )
      .map((r) => [r.id, r]),
  );
  return actions
    .filter(
      (a) =>
        a.deviceType === q.deviceType &&
        a.deviceNumber === q.deviceNumber &&
        selected.has(a.recordId),
    )
    .map((a) => {
      const record = selected.get(a.recordId)!,
        verified = a.verificationStatus === "VERIFIED" && !!a.verifiedBy;
      return {
        actionId: a.id,
        recordId: a.recordId,
        deviceType: a.deviceType,
        deviceNumber: a.deviceNumber,
        measurementDate: record.date,
        measurementTime: record.time,
        correctiveAction: a.description,
        performedBy: a.performedByName,
        actionStatus: a.actionStatus,
        verificationStatus: a.verificationStatus,
        verifiedBy: verified ? a.verifiedByName : "",
        verifiedAt: verified ? a.verifiedAt : "",
        source: a,
      };
    })
    .sort(
      (a, b) =>
        `${a.measurementDate} ${a.measurementTime}`.localeCompare(
          `${b.measurementDate} ${b.measurementTime}`,
        ) ||
        a.source.createdAt.localeCompare(b.source.createdAt) ||
        a.actionId.localeCompare(b.actionId),
    );
}
export async function createCorrection(
  input: z.infer<typeof correctionInputSchema>,
  actor: Actor,
  id = crypto.randomUUID(),
) {
  if (
    input.actionStatus &&
    input.actionStatus !== "PENDING" &&
    !(input.performedByName ?? actor.name).trim()
  )
    throw new AppError(
      400,
      "Dilakukan Oleh wajib diisi untuk Perbaikan atau Selesai",
    );
  const records = await getRecords(input.deviceType),
    record = records.find((r) => r.id === input.recordId);
  if (!record || measurementIndex(record, input.deviceNumber) < 0)
    throw new AppError(404, "Record/perangkat tidak ditemukan");
  if (actor.role === "PETUGAS" && record.createdBy !== actor.id)
    throw new AppError(
      403,
      "Hanya dapat mencatat tindakan pada pengukuran sendiri",
    );
  const ids = await ensureSheetHeaders(),
    now = new Date().toISOString();
  const existing = (await getCorrections()).find((a) => a.id === id);
  if (existing) {
    if (
      existing.performedBy !== actor.id ||
      existing.recordId !== input.recordId ||
      existing.description !== input.description ||
      existing.date !== input.date ||
      existing.time !== input.time ||
      existing.deviceType !== input.deviceType ||
      existing.deviceNumber !== input.deviceNumber ||
      (existing.actionStatus ?? "PENDING") !==
        (input.actionStatus ?? "PENDING") ||
      existing.performedByName !== (input.performedByName ?? actor.name)
    )
      throw new AppError(409, "Request ID telah digunakan");
    return existing;
  }
  const row = [
    id,
    input.recordId,
    input.deviceType.toUpperCase(),
    input.deviceNumber,
    input.date,
    input.time,
    input.description,
    actor.id,
    "PENDING",
    "",
    "",
    now,
    now,
    input.performedByName ?? actor.name,
    "",
    measurementValue(record, input.deviceNumber) ?? null,
    record.deviceStates?.[measurementIndex(record, input.deviceNumber)]
      ?.temperatureStatus || record.status,
    input.actionStatus || "PENDING",
    actor.id,
    actor.id,
    record.policyVersion || "legacy-unversioned",
  ];
  await batch([
    append(ids[ACTIONS], row),
    audit(ids, actor, "CREATE_TEMPERATURE_CORRECTION", id, null, row),
  ]);
  return decodeCorrection(row);
}
export async function verifyCorrection(
  id: string,
  version: string,
  actor: Actor,
) {
  if (!["ADMIN", "SUPERVISOR", "SUPER_ADMIN"].includes(actor.role))
    throw new AppError(403, "Verifikasi memerlukan kewenangan pemeriksa");
  const ids = await ensureSheetHeaders(),
    data = await rows(ACTIONS),
    index = data.findIndex((r) => r[0] === id);
  if (index < 1) throw new AppError(404, "Tindakan tidak ditemukan");
  const before = [...data[index]],
    row = [...before];
  if (row[8] !== "PENDING" || row[12] !== version)
    throw new AppError(409, "Tindakan sudah diverifikasi atau berubah");
  row[8] = "VERIFIED";
  row[9] = actor.id;
  row[10] = new Date().toISOString();
  row[12] = row[10];
  row[14] = actor.name;
  if (row[17]) row[19] = actor.id;
  await batch([
    replace(ids[ACTIONS], index, row),
    audit(ids, actor, "VERIFY_TEMPERATURE_CORRECTION", id, before, row),
  ]);
  return decodeCorrection(row);
}
export async function getControlData(filter: ControlFilter, id = "PREVIEW") {
  const { settings, version } = await controlSettings();
  const [all, sop, actions] = await Promise.all([
    getRecords(filter.kind),
    getSop(),
    getCorrections(),
  ]);
  const records = selectControlRecords(all, filter).filter(
      (r) => measurementIndex(r, filter.deviceNumber) >= 0,
    ),
    readings = normalizeReadings(records, filter, sop);
  if (readings.length > 2000)
    throw new AppError(400, "Persempit laporan (maksimum 2000 pembacaan)");
  let reportSop = sop[filter.kind];
  let normalRangeNote: string | undefined;
  if (filter.kind === "freezer" && records.length) {
    const ranges = records.map((r) => r.policy?.freezer ?? null),
      first = ranges[0];
    if (
      first &&
      ranges.every((p) => p && p.min === first.min && p.max === first.max)
    )
      reportSop = { min: first.min, max: first.max };
    else {
      reportSop = null;
      normalRangeNote = ranges.every((p) => p === null)
        ? "Belum ditetapkan saat pencatatan"
        : "Mengikuti SOP masing-masing pengukuran";
    }
  }
  const dates = reportDates(filter);
  const matched = await getCorrectiveActionsForReport(
    {
      deviceType: filter.kind,
      deviceNumber: filter.deviceNumber,
      startDate: dates[0],
      endDate: dates.at(-1)!,
    },
    { records, actions },
  );
  const corrections = matched.map((a) => ({
    ...a.source,
    date: a.measurementDate,
    time: a.measurementTime,
    verifiedByName: a.verifiedBy,
    verifiedAt: a.verifiedAt,
  }));
  // Hash unchanged database sources; presentation order/dates must not invalidate approval.
  const sourceCorrections = matched
    .map((a) => a.source)
    .sort((a, b) => a.id.localeCompare(b.id));
  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify({
        filter,
        settings,
        version,
        sop: reportSop,
        readings: [...readings].sort((a, b) =>
          a.recordId.localeCompare(b.recordId),
        ),
        corrections: sourceCorrections,
      }),
    )
    .digest("hex");
  const report: TemperatureReport = {
    id,
    createdAt: new Date().toISOString(),
    company: "PT BOGA RASA TAMA",
    filter,
    device: {
      type: filter.kind,
      number: filter.deviceNumber,
      coldStorage: filter.coldStorage || "BELUM DIKONFIGURASI",
    },
    settings,
    sop: reportSop,
    ...(normalRangeNote ? { normalRangeNote } : {}),
    readings,
    corrections,
    pages: makeControlPages(readings, filter, settings),
    sourceHash,
    settingsVersion: version,
  };
  return { report, records, sop };
}
export async function controlVerification(
  id: string,
): Promise<TemperatureVerification | null> {
  const row = (await rows(VERIFY)).find((r) => r[0] === id);
  return row
    ? {
        reportId: id,
        verifiedByUserId: String(row[1]),
        verifiedAt: String(row[2]),
        status: String(row[3]) as TemperatureVerification["status"],
        signatureReference: String(row[4]),
        sourceHash: String(row[5]),
        invalidatedAt: String(row[6] || ""),
        name: String(row[7]),
      }
    : null;
}
export function verificationRow(
  report: TemperatureReport,
  actor: Actor,
  signatureId: string,
  at: string,
) {
  return [
    report.id,
    actor.id,
    at,
    "VERIFIED",
    signatureId,
    report.sourceHash,
    "",
    actor.name,
  ];
}
/** Caller holds the persistent mutation lock before persisting invalidation. */
export async function checkControlFresh(
  report: TemperatureReport,
  actor?: Actor,
) {
  const current = await getControlData(report.filter),
    fresh = current.report.sourceHash === report.sourceHash;
  const verification = await controlVerification(report.id);
  if (!fresh && verification?.status === "VERIFIED" && actor) {
    const ids = await ensureSheetHeaders(),
      data = await rows(VERIFY),
      index = data.findIndex((r) => r[0] === report.id),
      before = [...data[index]],
      after = [...before];
    after[3] = "INVALIDATED";
    after[6] = new Date().toISOString();
    await batch([
      replace(ids[VERIFY], index, after),
      audit(ids, actor, "INVALIDATE_CONTROL_REPORT", report.id, before, after),
    ]);
    verification.status = "INVALIDATED";
    verification.invalidatedAt = String(after[6]);
  }
  return { fresh, verification };
}
