import { requireActor } from "@/lib/server/auth";
import { allRecords, rows } from "@/lib/server/sheets";
import { certificateConfigured } from "@/lib/server/reports";
import { filterRecords } from "@/lib/domain";
import { ok, fail } from "@/lib/server/errors";
export async function GET(req: Request) {
  try {
    await requireActor();
    return ok({
      records: filterRecords(await allRecords(), new URL(req.url).searchParams),
      reports: (await rows("REPORTS")).slice(1).map((r) => ({
        id: r[0],
        createdAt: r[1],
        status: r[4],
        approver: r[5],
        approvedAt: r[6],
        revisionOf: r[9],
      })),
      certificateConfigured: certificateConfigured(),
    });
  } catch (e) {
    return fail(e);
  }
}
