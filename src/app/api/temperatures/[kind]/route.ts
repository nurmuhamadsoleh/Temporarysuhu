import { readJson } from "@/lib/server/body";
import {
  config,
  measurementSchema,
  filterRecords,
  type Kind,
} from "@/lib/domain";
import { requireActor } from "@/lib/server/auth";
import { createTemperatureRecord, getRecords } from "@/lib/server/sheets";
import { ok, fail, AppError, originCheck } from "@/lib/server/errors";
import { locked } from "@/lib/server/storage";
import { createHash } from "node:crypto";
import { z } from "zod";
import { temperatureSave } from "@/lib/server/save-diagnostics";
export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string }> };
export async function GET(req: Request, c: Context) {
  try {
    await requireActor();
    const { kind } = await c.params;
    if (!Object.hasOwn(config, kind))
      throw new AppError(404, "Jenis tidak valid");
    return ok(
      filterRecords(
        await getRecords(kind as Kind),
        new URL(req.url).searchParams,
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request, c: Context) {
  const { kind } = await c.params;
  const operation = temperatureSave("create", kind);
  try {
    originCheck(req);
    const actor = await requireActor(["ADMIN", "PETUGAS"]);
    if (!Object.hasOwn(config, kind))
      throw new AppError(404, "Jenis tidak valid");
    operation.progress("validation");
    const input = measurementSchema(kind as Kind).parse(await readJson(req));
    const key = z.uuid().parse(req.headers.get("Idempotency-Key"));
    const hash = createHash("sha256")
      .update(JSON.stringify({ kind, input }))
      .digest("hex");
    operation.progress("storage");
    return operation.complete(
      ok(
        await locked(() =>
          createTemperatureRecord(
            kind as Kind,
            input,
            actor,
            key,
            hash,
            operation.progress,
          ),
        ),
        "Data tersimpan dan terverifikasi",
        201,
      ),
    );
  } catch (e) {
    return operation.failed(e);
  }
}
