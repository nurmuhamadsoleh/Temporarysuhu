import {
  type TemperatureStatusCode,
  type actionStatuses,
} from "@/lib/temperature-policy";
import { z } from "zod";
import {
  config,
  dateSchema,
  timeSchema,
  normalize,
  type Kind,
  type Measurement,
  type Sop,
} from "@/lib/domain";

export const controlFilterSchema = z
  .object({
    kind: z.enum(["chiller", "freezer"]),
    deviceNumber: z.coerce.number().int().min(1).max(5),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    coldStorage: z.string().trim().max(80).default(""),
    officer: z.string().trim().max(150).default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.deviceNumber > config[v.kind].count)
      ctx.addIssue({
        code: "custom",
        message: "Nomor perangkat tidak tersedia",
        path: ["deviceNumber"],
      });
    const prefix = `${v.year}-${String(v.month).padStart(2, "0")}-`;
    if (
      (v.from && !v.from.startsWith(prefix)) ||
      (v.to && !v.to.startsWith(prefix)) ||
      (v.from && v.to && v.from > v.to)
    )
      ctx.addIssue({
        code: "custom",
        message: "Periode harus berada dalam bulan yang dipilih",
        path: ["from"],
      });
  });
export type ControlFilter = z.infer<typeof controlFilterSchema>;
export const reportConfigSchema = z
  .object({
    schedule: z
      .array(timeSchema)
      .min(1)
      .max(12)
      .refine((v) => new Set(v).size === v.length, "Jam tidak boleh duplikat"),
    daysPerPage: z.number().int().min(1).max(10),
    paper: z.enum(["A4", "A3"]),
    operatorStyle: z.enum(["initials", "name"]),
    correctionSopText: z.string().trim().max(2000),
    correctionSopApproved: z.boolean(),
    connectAcrossGaps: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => !v.correctionSopApproved || !!v.correctionSopText,
    "Isi SOP sebelum mengesahkannya",
  );
export type ReportConfig = z.infer<typeof reportConfigSchema>;
export const defaultReportConfig: ReportConfig = {
  schedule: ["03:00", "07:00", "11:00", "15:00", "19:00", "23:00"],
  daysPerPage: 7,
  paper: "A4",
  operatorStyle: "initials",
  correctionSopText: "",
  correctionSopApproved: false,
};
export type TemperatureDevice = {
  type: Kind;
  number: number;
  coldStorage: string;
};
export type TemperatureReading = {
  recordId: string;
  deviceType: Kind;
  deviceNumber: number;
  timestamp: string;
  date: string;
  time: string;
  temperatureCelsius: number | null;
  policyVersion?: string;
  operatorId: string;
  operatorName: string;
  operatorFullName?: string;
  signatureReference: string;
  status: "NORMAL" | "ALERT" | "BELUM DIKONFIGURASI" | TemperatureStatusCode;
  notes: string;
  updatedAt: string;
};
export type TemperatureCorrection = {
  id: string;
  recordId: string;
  deviceType: Kind;
  deviceNumber: number;
  date: string;
  time: string;
  description: string;
  performedBy: string;
  performedByName: string;
  verificationStatus: "PENDING" | "VERIFIED";
  actionStatus?: (typeof actionStatuses)[number];
  temperatureCelsius?: number | null;
  temperatureStatus?: string;
  policyVersion?: string;
  performerIsManual?: boolean;
  verifiedBy: string;
  verifiedByName: string;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
};
export type TemperatureVerification = {
  reportId: string;
  verifiedByUserId: string;
  name: string;
  verifiedAt: string;
  status: "VERIFIED" | "INVALIDATED";
  signatureReference: string;
  sourceHash: string;
  invalidatedAt: string;
};
export type ReportColumn = {
  date: string;
  time: string;
  scheduled: boolean;
  readingIds: string[];
};
export type TemperaturePlotPoint = {
  x: number;
  y: number;
  readingIds: string[];
  count: number;
  temperatureCelsius: number;
  status: TemperatureReading["status"];
};
export type ControlPage = {
  columns: ReportColumn[];
  points: TemperaturePlotPoint[];
};
export type TemperatureReport = {
  presentation?: { supervisorName: string };
  id: string;
  createdAt: string;
  company: string;
  filter: ControlFilter;
  device: TemperatureDevice;
  settings: ReportConfig;
  sop: { min: number; max: number } | null;
  readings: TemperatureReading[];
  corrections: TemperatureCorrection[];
  pages: ControlPage[];
  sourceHash: string;
  settingsVersion: string;
};
export const correctionInputSchema = z
  .object({
    recordId: z.uuid(),
    deviceType: z.enum(["chiller", "freezer"]),
    deviceNumber: z.number().int().min(1).max(5),
    date: dateSchema,
    time: timeSchema,
    description: z.string().trim().min(1).max(2000),
    performedByName: z.string().trim().max(150).optional(),
    actionStatus: z.enum(["PENDING", "PERBAIKAN", "SELESAI"]).optional(),
  })
  .strict();
export function reportDates(f: ControlFilter) {
  const last = new Date(Date.UTC(f.year, f.month, 0)).getUTCDate(),
    prefix = `${f.year}-${String(f.month).padStart(2, "0")}-`;
  return Array.from(
    { length: last },
    (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`,
  ).filter((d) => (!f.from || d >= f.from) && (!f.to || d <= f.to));
}
export function selectControlRecords(records: Measurement[], f: ControlFilter) {
  const dates = new Set(reportDates(f));
  return records
    .filter((r) => r.kind === f.kind)
    .map((r) => {
      let date = String(r.date),
        time = String(r.time);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date))
        date = `${date.slice(6)}-${date.slice(3, 5)}-${date.slice(0, 2)}`;
      else if (/^\d+(\.\d+)?$/.test(date)) {
        const serial = Number(date);
        if (!Number.isInteger(serial))
          throw new Error("Tanggal sumber memiliki komponen jam yang ambigu");
        date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
          .toISOString()
          .slice(0, 10);
      }
      if (/^0(\.\d+)?$/.test(time)) {
        const minute = Number(time) * 1440;
        if (Math.abs(minute - Math.round(minute)) > 1e-6)
          throw new Error(
            "Jam sumber memiliki detik; perlu normalisasi eksplisit",
          );
        const m = Math.round(minute);
        time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      } else if (/^\d:\d{2}$/.test(time)) time = `0${time}`;
      if (
        !dateSchema.safeParse(date).success ||
        !timeSchema.safeParse(time).success
      )
        throw new Error("Tanggal/jam sumber laporan tidak valid");
      return { ...r, date, time };
    })
    .filter(
      (r) =>
        r.kind === f.kind &&
        dates.has(r.date) &&
        (!f.officer ||
          r.officer
            .toLocaleLowerCase("id")
            .includes(f.officer.toLocaleLowerCase("id"))),
    );
}
export function normalizeReadings(
  records: Measurement[],
  f: ControlFilter,
  sop: Sop,
): TemperatureReading[] {
  const bound = sop[f.kind];
  const seen = new Set<string>();
  return selectControlRecords(records, f)
    .map<TemperatureReading>((r) => {
      if (seen.has(r.id))
        throw new Error("RECORD ID duplikat pada sumber laporan");
      seen.add(r.id);
      const value = r.values[f.deviceNumber - 1];
      if (
        value !== null &&
        (typeof value !== "number" || !Number.isFinite(value))
      )
        throw new Error("Nilai perangkat bukan NUMBER");
      return {
        recordId: r.id,
        deviceType: f.kind,
        deviceNumber: f.deviceNumber,
        date: r.date,
        time: r.time,
        timestamp: `${r.date}T${r.time}:00+07:00`,
        temperatureCelsius: value === null ? null : normalize(value),
        operatorId: r.createdBy,
        operatorName: r.officer,
        signatureReference: r.signatureId || "",
        status:
          r.deviceStates?.[f.deviceNumber - 1]?.temperatureStatus ??
          (value === null
            ? "UNFILLED"
            : !bound
              ? "BELUM DIKONFIGURASI"
              : value < bound.min || value > bound.max
                ? "ALERT"
                : "NORMAL"),
        notes: [r.notes, r.deviceStates?.[f.deviceNumber - 1]?.missingReason]
          .filter(Boolean)
          .join("\n"),
        ...(r.policyVersion ? { policyVersion: r.policyVersion } : {}),
        updatedAt: r.updatedAt,
      };
    })
    .sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) ||
        a.recordId.localeCompare(b.recordId),
    );
}
export const temperatureY = (value: number, kind: Kind) =>
  (config[kind].max - value) / (config[kind].max - config[kind].min);
export const pageSize = (paper: ReportConfig["paper"]) =>
  paper === "A3" ? { width: 1191, height: 842 } : { width: 842, height: 595 };
export function makeControlPages(
  readings: TemperatureReading[],
  f: ControlFilter,
  settings: ReportConfig,
): ControlPage[] {
  const capacity = Math.floor((pageSize(settings.paper).width - 100) / 24),
    pages: ControlPage[] = [];
  let columns: ReportColumn[] = [],
    dates = new Set<string>();
  const flush = () => {
    if (!columns.length) return;
    const points: TemperaturePlotPoint[] = [];
    columns.forEach((column, i) => {
      const groups = new Map<number, TemperatureReading[]>();
      for (const r of readings.filter(
        (r) => r.date === column.date && r.time === column.time,
      ))
        if (r.temperatureCelsius !== null)
          groups.set(r.temperatureCelsius, [
            ...(groups.get(r.temperatureCelsius) || []),
            r,
          ]);
      for (const [value, group] of groups) {
        // Up to 3 equal readings are jittered horizontally, never vertically.
        // Larger groups use a counted marker; every reading remains in the appendix.
        const clusters = group.length > 3 ? [group] : group.map((r) => [r]);
        clusters.forEach((cluster, j) =>
          points.push({
            x:
              (i +
                0.5 +
                (clusters.length === 1
                  ? 0
                  : (j - (clusters.length - 1) / 2) * 0.22)) /
              columns.length,
            y: temperatureY(value, f.kind),
            readingIds: cluster.map((r) => r.recordId),
            count: cluster.length,
            temperatureCelsius: value,
            status: cluster[0].status,
          }),
        );
      }
    });
    pages.push({ columns, points });
    columns = [];
    dates = new Set();
  };
  for (const date of reportDates(f)) {
    const actual = [
      ...new Set(readings.filter((r) => r.date === date).map((r) => r.time)),
    ]
      .filter((t) => !settings.schedule.includes(t))
      .sort();
    const clock = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const relative = (time: string) =>
      (clock(time) - clock(settings.schedule[0]) + 1440) % 1440;
    const sequence = settings.schedule.map(relative);
    const cyclic = sequence.every((v, i) => !i || v > sequence[i - 1]);
    const times = [...settings.schedule, ...actual];
    if (cyclic) times.sort((a, b) => relative(a) - relative(b));
    if (
      columns.length &&
      (dates.size >= settings.daysPerPage ||
        columns.length + times.length > capacity)
    )
      flush();
    for (const time of times) {
      if (columns.length >= capacity) flush();
      dates.add(date);
      columns.push({
        date,
        time,
        scheduled: settings.schedule.includes(time),
        readingIds: readings
          .filter((r) => r.date === date && r.time === time)
          .map((r) => r.recordId),
      });
    }
  }
  flush();
  return pages;
}
