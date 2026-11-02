import { z } from "zod";
import { readJson } from "@/lib/server/body";
import { requireActor } from "@/lib/server/auth";
import { approveReport } from "@/lib/server/reports";
import { locked } from "@/lib/server/storage";
import { ok, fail, originCheck } from "@/lib/server/errors";
export async function POST(
  req: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    originCheck(req);
    const actor = await requireActor(["ADMIN", "SUPERVISOR"]);
    const id = z.uuid().parse((await c.params).id);
    const { signatureId } = z
      .object({ signatureId: z.uuid() })
      .parse(await readJson(req));
    return ok(await locked(() => approveReport(id, actor, signatureId)));
  } catch (e) {
    return fail(e);
  }
}
