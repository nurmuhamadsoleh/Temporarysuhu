import {
  deviceInputSchema,
  type DeviceState,
  type TemperaturePolicy,
} from "./temperature-policy";
import { z } from "./validation";
import {
  LEGACY_DEVICE_COUNTS,
  DEFAULT_CHILLER_COUNT,
  DEFAULT_FREEZER_COUNT,
  MAX_MEASUREMENT_DEVICES,
  MAX_DEVICE_NUMBER,
  type DeviceRef,
} from "./devices";
import { FREEZER_TEMPERATURE_POLICY } from "@/config/temperature";
import { isValid, parse, format } from "date-fns";
export const kinds = ["chiller", "freezer"] as const;
export type Kind = (typeof kinds)[number];
export const roles = ["SUPER_ADMIN", "ADMIN", "SUPERVISOR", "PETUGAS"] as const;
export type Role = (typeof roles)[number];
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  picture?: string;
  googleId?: string;
};
export const config = {
  chiller: {
    label: "Chiller",
    count: DEFAULT_CHILLER_COUNT,
    min: -2,
    max: 14,
    options: [-2, 0, 2, 4, 6, 8, 10, 12, 14],
    sheet: "Suhu Chiller",
  },
  freezer: {
    label: "Freezer",
    count: DEFAULT_FREEZER_COUNT,
    min: FREEZER_TEMPERATURE_POLICY.minSlider,
    max: FREEZER_TEMPERATURE_POLICY.maxSlider,
    options: [-22, -20, -18, -16, -14, -12, -10, -8, -6],
    sheet: "Suhu Freezer",
  },
};
export const normalize = (v: number) => Math.round(v * 10) / 10;
export const temperatureFormat = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const temperature = (v: number | null) =>
  v === null ? "Belum diisi" : `${temperatureFormat.format(v)}°C`;
export const dateSchema = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      isValid(parse(v, "yyyy-MM-dd", new Date())) &&
      format(parse(v, "yyyy-MM-dd", new Date()), "yyyy-MM-dd") === v,
    "Tanggal tidak valid",
  );
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam tidak valid");
export function temperatureValueSchema(kind: Kind) {
  return z
    .number()
    .finite()
    .min(config[kind].min)
    .max(config[kind].max)
    .refine(
      (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-7,
      "Gunakan kelipatan 0,1°C",
    )
    .transform(normalize);
}
export function measurementSchema(kind: Kind) {
  return z
    .object({
      date: dateSchema,
      time: timeSchema,
      values: z
        .array(temperatureValueSchema(kind).nullable())
        .min(1)
        .max(MAX_MEASUREMENT_DEVICES),
      devices: z
        .array(deviceInputSchema)
        .max(MAX_MEASUREMENT_DEVICES)
        .optional(),
      deviceRefs: z
        .array(
          z
            .object({
              id: z
                .string()
                .min(1)
                .max(100)
                .regex(/^[a-zA-Z0-9-]+$/),
              number: z.number().int().min(1).max(MAX_DEVICE_NUMBER),
            })
            .strict(),
        )
        .max(MAX_MEASUREMENT_DEVICES)
        .optional(),
      notes: z.string().max(2000).default(""),
      signatureId: z.uuid(),
      version: z.string().optional(),
      policyVersion: z.string().max(100).optional(),
    })
    .strict()
    .superRefine((input, ctx) => {
      if (
        !input.deviceRefs &&
        input.values.length !== LEGACY_DEVICE_COUNTS[kind]
      )
        ctx.addIssue({
          code: "custom",
          path: ["values"],
          message: "Daftar perangkat wajib untuk jumlah input dinamis",
        });
      if (input.devices && input.devices.length !== input.values.length)
        ctx.addIssue({
          code: "custom",
          path: ["devices"],
          message: "Koreksi harus sesuai setiap perangkat",
        });
      if (
        input.deviceRefs &&
        (input.deviceRefs.length !== input.values.length ||
          new Set(input.deviceRefs.map((d) => d.id)).size !==
            input.deviceRefs.length ||
          new Set(input.deviceRefs.map((d) => d.number)).size !==
            input.deviceRefs.length ||
          input.deviceRefs.some(
            (d, i) => i > 0 && d.number <= input.deviceRefs![i - 1].number,
          ))
      )
        ctx.addIssue({
          code: "custom",
          path: ["deviceRefs"],
          message:
            "Identitas/nomor perangkat harus unik, berurutan dan sesuai pembacaan",
        });
      input.values.forEach((value, index) => {
        if (value === null && !input.devices?.[index]?.missingReason.trim())
          ctx.addIssue({
            code: "custom",
            path: ["devices", index, "missingReason"],
            message: "Alasan belum dilakukan pengukuran wajib diisi",
          });
      });
    });
}
export type MeasurementInput = z.infer<ReturnType<typeof measurementSchema>>;
export type Measurement = MeasurementInput & {
  deviceRefs?: DeviceRef[];
  id: string;
  kind: Kind;
  officer: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  deviceStates?: DeviceState[];
  policy?: TemperaturePolicy;
  policyVersion?: string;
};
export type Sop = {
  chiller: { min: number; max: number } | null;
  freezer: { min: number; max: number } | null;
};
export const sopSchema = z.object({
  chiller: z
    .object({
      min: z.number().min(-2).max(14),
      max: z.number().min(-2).max(14),
    })
    .refine((v) => v.min <= v.max)
    .nullable(),
  freezer: z
    .object({
      min: z.number().min(-22).max(-6),
      max: z.number().min(-22).max(-6),
    })
    .refine((v) => v.min <= v.max)
    .nullable(),
});
export function statusFor(values: (number | null)[], kind: Kind, sop: Sop) {
  const s = sop[kind];
  return !s
    ? "BELUM DIKONFIGURASI"
    : values.some((v) => v !== null && (v < s.min || v > s.max))
      ? "ALERT"
      : "NORMAL";
}
export function jakartaNow() {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(" ");
  return { date: p[0], time: p[1] };
}
export const displayDate = (s: string) => s.split("-").reverse().join("/");
export function filterRecords(records: Measurement[], p: URLSearchParams) {
  return records
    .filter(
      (r) =>
        (!p.get("kind") ||
          p.get("kind") === "all" ||
          r.kind === p.get("kind")) &&
        (!p.get("from") || r.date >= p.get("from")!) &&
        (!p.get("to") || r.date <= p.get("to")!) &&
        (!p.get("officer") ||
          r.officer.toLowerCase().includes(p.get("officer")!.toLowerCase())) &&
        (!p.get("status") || r.status === p.get("status")) &&
        (!p.get("q") ||
          `${r.officer} ${r.notes} ${r.date}`
            .toLowerCase()
            .includes(p.get("q")!.toLowerCase())),
    )
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}
