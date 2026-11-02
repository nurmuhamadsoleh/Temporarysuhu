import { requireActor } from "@/lib/server/auth";
import { ensureSheetHeaders } from "@/lib/server/sheets";
import { locked } from "@/lib/server/storage";
import { ok, fail, originCheck } from "@/lib/server/errors";
export async function POST(req: Request) {
  try {
    originCheck(req);
    await requireActor(["ADMIN"]);
    return ok(await locked(ensureSheetHeaders));
  } catch (e) {
    return fail(e);
  }
}
