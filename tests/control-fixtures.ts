import type { Measurement, Kind } from "@/lib/domain";
import {
  defaultReportConfig,
  normalizeReadings,
  makeControlPages,
  type ControlFilter,
  type TemperatureReport,
} from "@/lib/temperature-report/model";
export const fixtureFilter = (
  kind: Kind = "chiller",
  deviceNumber = 1,
): ControlFilter => ({
  kind,
  deviceNumber,
  month: 11,
  year: 2026,
  coldStorage: "",
  officer: "",
});
export function fixtureRecord(
  kind: Kind = "chiller",
  overrides: Partial<Measurement> = {},
): Measurement {
  return {
    id: crypto.randomUUID(),
    kind,
    date: "2026-11-10",
    time: "07:00",
    values:
      kind === "chiller"
        ? [1.8, 2.3, 4.7, 0, 0.5]
        : [-18.5, -20.7, -17.3, -19.8],
    notes: "DATA UJI - BUKAN CATATAN OPERASIONAL",
    signatureId: "",
    status: "BELUM DIKONFIGURASI",
    officer: "Petugas Data Uji",
    createdBy: "test-operator",
    updatedBy: "test-operator",
    createdAt: "2026-11-10T00:00:00Z",
    updatedAt: "2026-11-10T00:00:00Z",
    ...overrides,
  };
}
export function fixtureReport(
  kind: Kind = "chiller",
  deviceNumber = 1,
  records = [fixtureRecord(kind)],
): TemperatureReport {
  const filter = {
      ...fixtureFilter(kind, deviceNumber),
      from: "2026-11-09",
      to: "2026-11-16",
    },
    sop = { chiller: { min: 0, max: 4 }, freezer: { min: -22, max: -18 } };
  const readings = normalizeReadings(records, filter, sop),
    settings = { ...defaultReportConfig };
  return {
    id: crypto.randomUUID(),
    createdAt: "2026-11-16T12:00:00Z",
    company: "PT BOGA RASA TAMA - DATA UJI / BUKAN OPERASIONAL",
    filter,
    device: {
      type: kind,
      number: deviceNumber,
      coldStorage: "BELUM DIKONFIGURASI",
    },
    settings,
    sop: sop[kind],
    readings,
    corrections: [],
    pages: makeControlPages(readings, filter, settings),
    sourceHash: "test-only",
    settingsVersion: "test-only",
  };
}
