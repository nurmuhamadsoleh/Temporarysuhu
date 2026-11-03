import { readLimited } from "@/lib/server/body";
import { z } from "zod";
import { persistSignature } from "@/lib/server/signature-persistence";
import { temperatureSave } from "@/lib/server/save-diagnostics";
import sharp from "sharp";
import { requireActor, rateLimit } from "@/lib/server/auth";
import { ok, originCheck, AppError } from "@/lib/server/errors";
import { locked } from "@/lib/server/storage";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const operation = temperatureSave(
    "signature",
    req.headers.get("X-Temperature-Type") || "",
  );
  try {
    originCheck(req);
    const actor = await requireActor();
    await rateLimit(`signature:${actor.id}`, 40);
    if (Number(req.headers.get("content-length") || 0) > 400000)
      throw new AppError(413, "Signature terlalu besar");
    operation.progress("validation");
    const headerKey = req.headers.get("Idempotency-Key");
    const key = headerKey === null ? undefined : z.uuid().parse(headerKey);
    const raw = await readLimited(req, 300000);
    if (raw.length > 300000 || req.headers.get("content-type") !== "image/png")
      throw new AppError(400, "Signature harus PNG di bawah 300KB");
    if (
      !raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new AppError(
        400,
        "Konten tanda tangan harus berupa PNG yang valid",
      );
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
    operation.progress("storage");
    const id = await locked(() =>
      persistSignature(data, actor, key, operation.progress),
    );
    return operation.complete(
      ok({ id }, "Signature tersimpan dan terverifikasi", 201),
    );
  } catch (e) {
    return operation.failed(e);
  }
}
