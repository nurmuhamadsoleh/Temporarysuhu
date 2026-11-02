import { readLimited } from "@/lib/server/body";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { requireActor, rateLimit } from "@/lib/server/auth";
import { ok, fail, originCheck, AppError } from "@/lib/server/errors";
import { putFile, locked } from "@/lib/server/storage";
import { ensureSheetHeaders, batch, append, audit } from "@/lib/server/sheets";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor();
    await rateLimit(`signature:${actor.id}`, 40);
    if (Number(req.headers.get("content-length") || 0) > 400000)
      throw new AppError(413, "Signature terlalu besar");
    const raw = await readLimited(req, 300000);
    if (raw.length > 300000 || req.headers.get("content-type") !== "image/png")
      throw new AppError(400, "Signature harus PNG di bawah 300KB");
    const image = sharp(raw, { limitInputPixels: 1000000 });
    const meta = await image.metadata();
    if (
      meta.format !== "png" ||
      !meta.width ||
      meta.width < 100 ||
      !meta.height ||
      meta.height < 50
    )
      throw new AppError(400, "Dimensi tanda tangan tidak valid");
    const data = await image
      .flatten({ background: "#fff" })
      .resize(800, 300, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const stats = await sharp(data).stats();
    if (stats.channels.slice(0, 3).every((c) => c.stdev < 2))
      throw new AppError(400, "Tanda tangan kosong");
    const id = crypto.randomUUID();
    await locked(async () => {
      await putFile(`${id}.png`, data);
      const ids = await ensureSheetHeaders();
      await batch([
        append(ids.SIGNATURE_METADATA, [
          id,
          actor.id,
          "",
          new Date().toISOString(),
          `${id}.png`,
          createHash("sha256").update(data).digest("hex"),
        ]),
        audit(ids, actor, "UPLOAD_SIGNATURE", id, null, { id }),
      ]);
    });
    return ok({ id }, "Signature tersimpan", 201);
  } catch (e) {
    return fail(e);
  }
}
