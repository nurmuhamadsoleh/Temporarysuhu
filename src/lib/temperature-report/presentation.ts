import { statusPalette } from "@/lib/temperature-policy";
import { displayDate } from "@/lib/domain";
import {
  reportDates,
  type TemperatureReport,
  type TemperatureReading,
} from "./model";

const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export const printableReportText = (text: string) => text.replace(uuid, "");
export function formatVerificationAt(value: string) {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} WIB`;
}
export function humanReportName(value: string | undefined): string {
  const name = (value || "").trim().replace(/\s+/g, " ");
  return !name ||
    /^P\d+$/i.test(name) ||
    name.includes("@") ||
    printableReportText(name) !== name
    ? ""
    : name;
}
export function monitoringPeriod(report: TemperatureReport) {
  const dates = reportDates(report.filter),
    from = dates[0],
    to = dates.at(-1)!;
  if (from === to) return `Tanggal: ${displayDate(from)}`;
  const last = new Date(
    Date.UTC(report.filter.year, report.filter.month, 0),
  ).getUTCDate();
  if (dates.length === last)
    return `Periode: ${new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(Date.UTC(report.filter.year, report.filter.month - 1, 15)))}`;
  return `Periode: ${displayDate(from)} - ${displayDate(to)}`;
}
export function operationalTemperatureStatus(
  reading: TemperatureReading,
  report: TemperatureReport,
) {
  if (reading.status === "UNFILLED") return "BELUM DIISI";
  if (reading.status in statusPalette)
    return statusPalette[reading.status as keyof typeof statusPalette].label;
  if (!report.sop) return "";
  return reading.status === "NORMAL"
    ? "Normal"
    : reading.status === "ALERT"
      ? "Di luar batas SOP"
      : "";
}
export const reportOperatorKey = (r: TemperatureReading) =>
  r.operatorId || `name:${r.operatorName}`;
export function reportOperators(report: TemperatureReport) {
  const operators = new Map<
    string,
    { key: string; code: string; name: string }
  >();
  for (const r of report.readings) {
    const key = reportOperatorKey(r);
    if (!operators.has(key))
      operators.set(key, {
        key,
        code: `P${operators.size + 1}`,
        name:
          humanReportName(r.operatorFullName) ||
          humanReportName(r.operatorName) ||
          "Tidak diketahui",
      });
  }
  return [...operators.values()];
}
