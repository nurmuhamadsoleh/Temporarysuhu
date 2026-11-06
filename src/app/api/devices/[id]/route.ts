import { z } from "@/lib/validation";
import { requireActor, rateLimit } from "@/lib/server/auth";
import { setTemperatureDeviceActive } from "@/lib/server/sheets";
import { ok, fail, originCheck } from "@/lib/server/errors";
import { readJson } from "@/lib/server/body";
import { locked } from "@/lib/server/storage";
export const runtime = "nodejs";
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit("devices-update:" + actor.id, 60);
    const { id } = await context.params;
    z.string()
      .regex(/^[a-zA-Z0-9-]{1,100}$/)
      .parse(id);
    const body = z
      .object({ active: z.boolean(), version: z.string().min(1).max(100) })
      .strict()
      .parse(await readJson(req));
    return ok(
      await locked(() =>
        setTemperatureDeviceActive(id, body.active, body.version, actor),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
