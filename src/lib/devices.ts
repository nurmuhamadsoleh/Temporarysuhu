import type { Kind, Measurement } from "./domain";
export const DEFAULT_CHILLER_COUNT = 6;
export const DEFAULT_FREEZER_COUNT = 5;
/** Fixed legacy sheet widths. Never expand these into the metadata columns. */
export const LEGACY_DEVICE_COUNTS = { chiller: 5, freezer: 4 } as const;
export const MAX_MEASUREMENT_DEVICES = 128;
export const MAX_DEVICE_NUMBER = 10000;
export type DeviceRef = { id: string; number: number };
export type TemperatureDeviceConfig = DeviceRef & {
  kind: Kind;
  label: string;
  active: boolean;
};
export const defaultDeviceId = (kind: Kind, number: number) =>
  "default-" + kind + "-" + number;
export const defaultDevices = (kind: Kind): TemperatureDeviceConfig[] =>
  Array.from(
    {
      length:
        kind === "chiller" ? DEFAULT_CHILLER_COUNT : DEFAULT_FREEZER_COUNT,
    },
    (_, i) => ({
      id: defaultDeviceId(kind, i + 1),
      kind,
      number: i + 1,
      label: (kind === "chiller" ? "Chiller " : "Freezer ") + (i + 1),
      active: true,
    }),
  );
export function measurementRefs(
  record: Pick<Measurement, "kind" | "values" | "deviceRefs">,
): DeviceRef[] {
  return (
    record.deviceRefs ??
    record.values.map((_, i) => ({
      id: defaultDeviceId(record.kind, i + 1),
      number: i + 1,
    }))
  );
}
export function measurementIndex(
  record: Pick<Measurement, "kind" | "values" | "deviceRefs">,
  number: number,
) {
  return measurementRefs(record).findIndex((d) => d.number === number);
}
export function measurementValue(
  record: Pick<Measurement, "kind" | "values" | "deviceRefs">,
  number: number,
) {
  const index = measurementIndex(record, number);
  return index < 0 ? undefined : record.values[index];
}
export function measuredDevices(
  records: Measurement[],
  kind: Kind,
): TemperatureDeviceConfig[] {
  const found = new Map<string, TemperatureDeviceConfig>();
  for (const record of records.filter((r) => r.kind === kind))
    for (const d of measurementRefs(record))
      found.set(d.id, {
        ...d,
        kind,
        active: true,
        label: (kind === "chiller" ? "Chiller " : "Freezer ") + d.number,
      });
  return [...found.values()].sort((a, b) => a.number - b.number);
}
