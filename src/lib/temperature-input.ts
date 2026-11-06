import type { Kind } from "./domain";
import { temperatureValueSchema, normalize } from "./domain";
export type TemperatureTextResult =
  { valid: true; value: number | null } | { valid: false; message: string };
/** Preserve the edit string. Incomplete '-'/'3,' is never a measurement. */
export function parseTemperatureText(
  text: string,
  kind: Kind,
): TemperatureTextResult {
  const raw = text.trim();
  if (raw === "") return { valid: true, value: null };
  if (!/^-?\d+(?:[.,]\d)?$/.test(raw))
    return {
      valid: false,
      message: "Gunakan angka dengan maksimal satu desimal (koma atau titik).",
    };
  const value = Number(raw.replace(",", "."));
  if (!temperatureValueSchema(kind).safeParse(value).success)
    return {
      valid: false,
      message:
        kind === "chiller"
          ? "Suhu Chiller harus -2°C sampai 14°C."
          : "Suhu Freezer harus -22°C sampai -6°C.",
    };
  return { valid: true, value: normalize(value) };
}
