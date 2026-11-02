import { z } from "zod";
import { requireActor } from "@/lib/server/auth";
import { signReport } from "@/lib/server/reports";
import { locked } from "@/lib/server/storage";
import { ok, fail, originCheck } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    originCheck(req);
    const actor = await requireActor(["ADMIN", "SUPERVISOR"]);
    const id = z.uuid().parse((await c.params).id);
    return ok(await locked(() => signReport(id, actor)));
  } catch (e) {
    return fail(e);
  }
}
