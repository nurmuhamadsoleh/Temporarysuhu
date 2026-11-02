import { z } from "zod";
import { policyBoundsSchema } from "@/lib/temperature-policy";
import { requireActor, rateLimit } from "@/lib/server/auth";
import {
  getTemperaturePolicy,
  saveTemperaturePolicy,
} from "@/lib/server/sheets";
import { locked } from "@/lib/server/storage";
import { readJson } from "@/lib/server/body";
import { ok, fail, originCheck } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function GET() {
  try {
    const actor = await requireActor();
    await rateLimit(`policy-read:${actor.id}`, 180);
    return ok(await getTemperaturePolicy());
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit(`policy-write:${actor.id}`, 30);
    const input = z
      .object({
        bounds: policyBoundsSchema,
        version: z.string().min(1).max(100),
      })
      .strict()
      .parse(await readJson(req));
    return ok(
      await locked(() =>
        saveTemperaturePolicy(input.bounds, input.version, actor),
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
