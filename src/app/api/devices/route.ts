import { MAX_DEVICE_NUMBER } from "@/lib/devices";
import { z } from "@/lib/validation";
import { requireActor, rateLimit } from "@/lib/server/auth";
import {
  getTemperatureDevices,
  registerTemperatureDevice,
} from "@/lib/server/sheets";
import { ok, fail, originCheck } from "@/lib/server/errors";
import { readJson } from "@/lib/server/body";
import { locked } from "@/lib/server/storage";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    await requireActor();
    const query = z
      .enum(["true", "false"])
      .parse(new URL(req.url).searchParams.get("includeInactive") ?? "false");
    return ok(await getTemperatureDevices(query === "true"));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit("devices-create:" + actor.id, 60);
    const body = z
      .object({
        kind: z.enum(["chiller", "freezer"]),
        expectedNumber: z
          .number()
          .int()
          .min(1)
          .max(MAX_DEVICE_NUMBER)
          .optional(),
      })
      .strict()
      .parse(await readJson(req));
    const id = z.uuid().parse(req.headers.get("Idempotency-Key"));
    return ok(
      await locked(() =>
        registerTemperatureDevice(body.kind, id, actor, body.expectedNumber),
      ),
      "Perangkat terdaftar",
      201,
    );
  } catch (error) {
    return fail(error);
  }
}
