import { z } from "./validation";
import type { Kind, Measurement } from "./domain";
import { FREEZER_TEMPERATURE_POLICY } from "@/config/temperature";
export { FREEZER_TEMPERATURE_POLICY };

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
    freezer: bounds(
      FREEZER_TEMPERATURE_POLICY.minSlider,
      FREEZER_TEMPERATURE_POLICY.maxSlider,
    ).nullable(),
  })
  .strict();
export type PolicyBounds = z.infer<typeof policyBoundsSchema>;
export type TemperaturePolicy = PolicyBounds & { version: string };
export const DEFAULT_TEMPERATURE_POLICY: TemperaturePolicy = {
  version: "chiller-v1-freezer-brt-v1",
  chiller: { min: 0, max: 4, warningMax: 5 },
  freezer: {
    min: FREEZER_TEMPERATURE_POLICY.normalMin,
    max: FREEZER_TEMPERATURE_POLICY.normalMax,
    warningMax: FREEZER_TEMPERATURE_POLICY.warningMax,
  },
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
const freezerDescriptions = {
  NORMAL: "Suhu Freezer dalam rentang normal.",
  WARNING: "Suhu Freezer mendekati batas suhu tinggi.",
  HIGH_TEMPERATURE: "Suhu Freezer terlalu tinggi. Pemeriksaan diperlukan.",
  LOW_TEMPERATURE:
    "Suhu Freezer berada di bawah rentang normal yang ditetapkan.",
  UNFILLED: "Pengukuran suhu Freezer belum dilakukan.",
};
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
  return {
    code,
    ...statusPalette[code],
    description:
      type === "freezer" && code !== "UNKNOWN_SOP"
        ? freezerDescriptions[code]
        : statusPalette[code].description,
  };
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
  deviceId?: string;
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

export type FreezerStatus =
  "NORMAL" | "WARNING" | "HIGH_TEMPERATURE" | "LOW_TEMPERATURE" | "BELUM_DIISI";
/** Convenience API for the initial policy; configured SOP callers use getTemperatureStatus. */
export function getFreezerStatus(temperature: number | null): FreezerStatus {
  const code = getTemperatureStatus(
    "freezer",
    temperature,
    DEFAULT_TEMPERATURE_POLICY,
  ).code;
  if (code === "UNFILLED") return "BELUM_DIISI";
  if (code === "UNKNOWN_SOP") throw new Error("Default Freezer policy missing");
  return code;
}
/** Use the assessment captured with a reading, never today's policy for old data. */
export function getRecordedTemperatureStatus(
  record: Pick<Measurement, "kind" | "values" | "deviceStates" | "policy">,
  index: number,
): TemperatureStatusCode {
  if (record.values[index] === null) return "UNFILLED";
  const stored = record.deviceStates?.[index]?.temperatureStatus;
  if (stored) return stored;
  if (record.policy)
    return getTemperatureStatus(
      record.kind,
      record.values[index],
      record.policy,
    ).code;
  return "UNKNOWN_SOP";
}
export function countRecordedStatuses(records: Measurement[]) {
  const counts = Object.fromEntries(
    Object.keys(statusPalette).map((code) => [code, 0]),
  ) as Record<TemperatureStatusCode, number>;
  for (const record of records)
    record.values.forEach(
      (_, index) => counts[getRecordedTemperatureStatus(record, index)]++,
    );
  return counts;
}
