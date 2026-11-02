import { AppError } from "./errors";
export async function readLimited(req: Request, max = 65536) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new AppError(413, "Request terlalu besar");
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new AppError(413, "Request terlalu besar");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function readJson(req: Request): Promise<unknown> {
  try {
    return JSON.parse((await readLimited(req)).toString("utf8"));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "JSON request tidak valid");
  }
}
