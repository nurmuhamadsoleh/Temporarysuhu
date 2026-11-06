import { temperatureSave } from "@/lib/server/save-diagnostics";
import { readJson } from "@/lib/server/body";
import { config, measurementSchema, type Kind } from "@/lib/domain";
import { requireActor } from "@/lib/server/auth";
import {
  getRecords,
  updateTemperatureRecord,
  deleteTemperatureRecord,
} from "@/lib/server/sheets";
import { ok, fail, AppError, originCheck } from "@/lib/server/errors";
import { locked } from "@/lib/server/storage";
export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string; id: string }> };
async function params(c: Context) {
  const p = await c.params;
  if (!Object.hasOwn(config, p.kind))
    throw new AppError(404, "Jenis tidak valid");
  return { ...p, kind: p.kind as Kind };
}
export async function GET(_: Request, c: Context) {
  try {
    await requireActor();
    const { kind, id } = await params(c);
    const r = (await getRecords(kind)).find((r) => r.id === id);
    if (!r) throw new AppError(404, "Record tidak ditemukan");
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(req: Request, c: Context) {
  const operation = temperatureSave("update", (await c.params).kind);
  try {
    originCheck(req);
    const actor = await requireActor(["ADMIN", "PETUGAS"]);
    const { kind, id } = await params(c);
    operation.progress("validation");
    const input = measurementSchema(kind).parse(await readJson(req, 2_000_000));
    operation.progress("storage");
    return operation.complete(
      ok(
        await locked(() =>
          updateTemperatureRecord(kind, id, input, actor, operation.progress),
        ),
      ),
    );
  } catch (e) {
    return operation.failed(e);
  }
}
export async function DELETE(req: Request, c: Context) {
  try {
    originCheck(req);
    const actor = await requireActor(["ADMIN"]);
    const { kind, id } = await params(c);
    await locked(() => deleteTemperatureRecord(kind, id, actor));
    return ok(null, "Data dihapus dan diaudit");
  } catch (e) {
    return fail(e);
  }
}
