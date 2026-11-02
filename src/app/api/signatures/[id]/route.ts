import { z } from "zod";
import { requireActor } from "@/lib/server/auth";
import { rows } from "@/lib/server/sheets";
import { getFile } from "@/lib/server/storage";
import { fail, AppError } from "@/lib/server/errors";
export async function GET(_: Request, c: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const id = z.uuid().parse((await c.params).id);
    const row = (await rows("SIGNATURE_METADATA")).find((r) => r[0] === id);
    if (!row) throw new AppError(404, "Signature tidak ditemukan");
    if (row[1] !== actor.id && !row[2] && actor.role === "PETUGAS")
      throw new AppError(403, "Signature privat");
    return new Response(new Uint8Array(await getFile(`${id}.png`)), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
