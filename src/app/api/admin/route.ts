import { sopSchema } from "@/lib/domain";
import { requireActor } from "@/lib/server/auth";
import {
  ensureSheetHeaders,
  rows,
  getSop,
  batch,
  append,
  replace,
  audit,
} from "@/lib/server/sheets";
import { locked } from "@/lib/server/storage";
import { readJson } from "@/lib/server/body";
import { z } from "zod";
import { ok, fail, originCheck } from "@/lib/server/errors";
export async function GET() {
  try {
    const actor = await requireActor(["ADMIN"]);
    return ok({
      sop: await getSop(),
      audit:
        actor.role === "SUPER_ADMIN"
          ? (await rows("AUDIT_LOG")).slice(1).slice(-100).reverse()
          : [],
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    const body = z
      .object({ action: z.literal("sop"), sop: sopSchema })
      .strict()
      .parse(await readJson(req));
    return ok(
      await locked(async () => {
        const ids = await ensureSheetHeaders(),
          data = await rows("APP_CONFIG"),
          index = data.findIndex((r) => r[0] === "SOP");
        await batch([
          index < 1
            ? append(ids.APP_CONFIG, ["SOP", JSON.stringify(body.sop)])
            : replace(ids.APP_CONFIG, index, ["SOP", JSON.stringify(body.sop)]),
          audit(ids, actor, "CONFIGURE_SOP", "SOP", await getSop(), body.sop),
        ]);
        return body.sop;
      }),
    );
  } catch (e) {
    return fail(e);
  }
}
