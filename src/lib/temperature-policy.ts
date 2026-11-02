import { z } from "zod";
import type { Kind } from "./domain";

const decimal = z
  .number()
  .finite()
  .refine(
    (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-7,
    "Gunakan presisi 0,1°C",
  );
const bounds = (min: number, max: number) =>
  z
    .object({
      min: decimal.min(min).max(max),
      max: decimal.min(min).max(max),
      warningMax: decimal.min(min).max(max).nullable(),
    })
    .strict()
    .refine(
      (v) => v.min <= v.max && (v.warningMax === null || v.warningMax >= v.max),
      "Urutan batas SOP tidak valid",
    );
export const policyBoundsSchema = z
  .object({
    chiller: bounds(-2, 14).nullable(),
    freezer: bounds(-22, -6).nullable(),
  })
  .strict();
export type PolicyBounds = z.infer<typeof policyBoundsSchema>;
export type TemperaturePolicy = PolicyBounds & { version: string };
export const DEFAULT_TEMPERATURE_POLICY: TemperaturePolicy = {
  version: "chiller-reference-v1",
  chiller: { min: 0, max: 4, warningMax: 5 },
  freezer: null,
};
export type TemperatureStatusCode =
  | "NORMAL"
  | "WARNING"
  | "HIGH_TEMPERATURE"
  | "LOW_TEMPERATURE"
  | "UNFILLED"
  | "UNKNOWN_SOP";
export const statusPalette = {
  NORMAL: {
    label: "NORMAL",
    description: "Suhu penyimpanan normal.",
    color: "#16A34A",
    background: "#DCFCE7",
    requiresCorrectiveAction: false,
  },
  WARNING: {
    label: "WARNING",
    description: "Mendekati batas maksimum.",
    color: "#F59E0B",
    background: "#FEF3C7",
    requiresCorrectiveAction: false,
  },
  HIGH_TEMPERATURE: {
    label: "HIGH TEMPERATURE",
    description: "Suhu terlalu tinggi.",
    color: "#DC2626",
    background: "#FEE2E2",
    requiresCorrectiveAction: true,
  },
  LOW_TEMPERATURE: {
    label: "LOW TEMPERATURE",
    description: "Suhu terlalu rendah.",
    color: "#2563EB",
    background: "#DBEAFE",
    requiresCorrectiveAction: true,
  },
  UNFILLED: {
    label: "BELUM DIISI",
    description: "Pengukuran suhu belum dilakukan.",
    color: "#64748B",
    background: "#F1F5F9",
    requiresCorrectiveAction: false,
  },
  UNKNOWN_SOP: {
    label: "BATAS SOP BELUM DITETAPKAN",
    description: "Batas SOP perangkat belum ditetapkan.",
    color: "#64748B",
    background: "#F1F5F9",
    requiresCorrectiveAction: false,
  },
} as const;
export function getTemperatureStatus(
  type: Kind,
  temperature: number | null,
  temperaturePolicy: TemperaturePolicy,
) {
  const p = temperaturePolicy[type];
  let code: TemperatureStatusCode;
  const n = temperature === null ? null : Math.round(temperature * 10);
  if (n === null) code = "UNFILLED";
  else if (!p) code = "UNKNOWN_SOP";
  else if (n < Math.round(p.min * 10)) code = "LOW_TEMPERATURE";
  else if (n <= Math.round(p.max * 10)) code = "NORMAL";
  else if (p.warningMax !== null && n <= Math.round(p.warningMax * 10))
    code = "WARNING";
  else code = "HIGH_TEMPERATURE";
  return { code, ...statusPalette[code] };
}
export const actionStatuses = ["PENDING", "PERBAIKAN", "SELESAI"] as const;
export const actionStatusLabels = {
  PENDING: "Pending",
  PERBAIKAN: "Perbaikan",
  SELESAI: "Selesai",
};
export const deviceInputSchema = z
  .object({
    missingReason: z.string().trim().max(1000).default(""),
    correctiveAction: z.string().trim().max(2000).default(""),
    performedBy: z.string().trim().max(150).default(""),
    actionStatus: z.enum(actionStatuses).default("PENDING"),
  })
  .strict();
export type DeviceInput = z.infer<typeof deviceInputSchema>;
export type DeviceState = DeviceInput & {
  actionId?: string;
  deviceNumber: number;
  temperatureStatus: TemperatureStatusCode;
};
export const emptyDeviceInput = (): DeviceInput => ({
  missingReason: "",
  correctiveAction: "",
  performedBy: "",
  actionStatus: "PENDING",
});
export function validateDeviceInputs(
  type: Kind,
  values: (number | null)[],
  devices: DeviceInput[],
  policy: TemperaturePolicy,
) {
  return values.flatMap((value, i) => {
    const d = devices[i] ?? emptyDeviceInput(),
      status = getTemperatureStatus(type, value, policy);
    const errors: string[] = [];
    if (value === null && !d.missingReason.trim())
      errors.push("Alasan belum dilakukan pengukuran wajib diisi");
    if (status.requiresCorrectiveAction && !d.correctiveAction.trim())
      errors.push("Keterangan / tindakan korektif wajib diisi");
    if (
      d.correctiveAction.trim() &&
      d.actionStatus !== "PENDING" &&
      !d.performedBy.trim()
    )
      errors.push("Dilakukan Oleh wajib diisi untuk Perbaikan atau Selesai");
    if (
      !d.correctiveAction.trim() &&
      (d.performedBy.trim() || d.actionStatus !== "PENDING")
    )
      errors.push(
        "Isi keterangan sebelum mencatat pelaksana atau status tindakan",
      );
    return errors.map((message) => ({ deviceNumber: i + 1, message }));
  });
}
export function aggregateTemperatureStatus(
  states: { temperatureStatus: TemperatureStatusCode }[],
) {
  const order: TemperatureStatusCode[] = [
    "HIGH_TEMPERATURE",
    "LOW_TEMPERATURE",
    "WARNING",
    "UNFILLED",
    "UNKNOWN_SOP",
    "NORMAL",
  ];
  return (
    order.find((code) => states.some((s) => s.temperatureStatus === code)) ??
    "UNFILLED"
  );
}
