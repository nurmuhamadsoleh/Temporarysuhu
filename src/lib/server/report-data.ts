import "server-only";
import { createHash } from "node:crypto";
import { userTable } from "./user-service";
import { safeLog } from "./safe-log";
import { DEFAULT_REPORT_SUPERVISOR_NAME } from "@/config/report";
import { humanReportName } from "@/lib/temperature-report/presentation";
import type { TemperatureReport } from "@/lib/temperature-report/model";

export function reportSupervisorName() {
  return (
    humanReportName(process.env.REPORT_SUPERVISOR_NAME) ||
    DEFAULT_REPORT_SUPERVISOR_NAME
  );
}
export type ReportUserIdentity = { id: string; name: string };
/** A display-only projection: no Sheets writes or modifications to audit/source hashes. */
export async function buildTemperatureReportData(
  report: TemperatureReport,
  identities?: ReportUserIdentity[],
): Promise<TemperatureReport> {
  const users = identities ?? (await userTable()).users;
  const names = new Map(users.map((u) => [u.id, humanReportName(u.name)]));
  const logged = new Set<string>();
  const resolve = (id: string, historical: string) => {
    const fullName = names.get(id);
    if (fullName) return fullName;
    if (!logged.has(id)) {
      logged.add(id);
      safeLog(
        "report_identity_fallback",
        "APP_USER_NAME_MISSING",
        createHash("sha256")
          .update(id || historical)
          .digest("hex")
          .slice(0, 12),
      );
    }
    return humanReportName(historical) || "Tidak diketahui";
  };
  return {
    ...report,
    presentation: { supervisorName: reportSupervisorName() },
    readings: report.readings.map((r) => {
      const operatorFullName = resolve(r.operatorId, r.operatorName);
      return { ...r, operatorName: operatorFullName, operatorFullName };
    }),
    corrections: report.corrections.map((a) => ({
      ...a,
      performedByName: a.performerIsManual
        ? a.performedByName
        : resolve(a.performedBy, a.performedByName),
      verifiedByName:
        a.verificationStatus === "VERIFIED" && a.verifiedBy
          ? resolve(a.verifiedBy, a.verifiedByName)
          : a.verifiedByName,
    })),
  };
}
