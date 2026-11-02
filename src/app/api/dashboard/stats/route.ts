import { requireActor } from "@/lib/server/auth";
import {
  allRecords,
  getTemperatureStatistics,
  rows,
  getSop,
} from "@/lib/server/sheets";
import { filterRecords } from "@/lib/domain";
import { ok, fail } from "@/lib/server/errors";
export async function GET(req: Request) {
  try {
    await requireActor();
    const records = filterRecords(
      await allRecords(),
      new URL(req.url).searchParams,
    );
    const sop = await getSop();
    return ok({
      records,
      statistics: {
        ...getTemperatureStatistics(records, sop),
        signedReports: (await rows("REPORTS"))
          .slice(1)
          .filter((r) => r[4] === "SIGNED").length,
      },
      sop,
    });
  } catch (e) {
    return fail(e);
  }
}
