import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "@/lib/domain";
import { AppError } from "./errors";
import { FeatureUnavailable } from "./dependency-failure";
import { getFile, putFile } from "./storage";
import { rows, ensureSheetHeaders, batch, append, audit } from "./sheets";
import type { SaveProgress } from "./save-diagnostics";
const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
function uploadId(actorId: string, key?: string) {
  if (!key) return randomUUID();
  const hex = createHash("sha256")
    .update(JSON.stringify(["signature-upload-v1", actorId, key]))
    .digest("hex")
    .slice(0, 32)
    .split("");
  // UUIDv8: application-defined SHA-256 namespace, scoped to the server actor.
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const s = hex.join("");
  return [
    s.slice(0, 8),
    s.slice(8, 12),
    s.slice(12, 16),
    s.slice(16, 20),
    s.slice(20),
  ].join("-");
}
/** Caller holds the shared filesystem mutation lock. Failed stages can be replayed. */
export async function persistSignature(
  data: Buffer,
  actor: Actor,
  key?: string,
  progress: SaveProgress = () => {},
) {
  const id = uploadId(actor.id, key),
    name = id + ".png",
    hash = digest(data);
  progress("sheets_read");
  const ids = await ensureSheetHeaders();
  const existing = (await rows("SIGNATURE_METADATA")).find((r) => r[0] === id);
  if (
    existing &&
    (existing[1] !== actor.id || existing[4] !== name || existing[5] !== hash)
  )
    throw new AppError(
      409,
      "Kunci unggah tanda tangan sudah digunakan untuk data lain.",
    );
  progress("storage");
  let stored: Buffer | undefined;
  try {
    stored = await getFile(name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  if (stored && digest(stored) !== hash)
    throw new FeatureUnavailable(
      "STORAGE_SIGNATURE_INTEGRITY",
      "Berkas tanda tangan tidak dapat diverifikasi.",
    );
  if (!stored) await putFile(name, data);
  if (digest(await getFile(name)) !== hash)
    throw new FeatureUnavailable(
      "STORAGE_SIGNATURE_INTEGRITY",
      "Penyimpanan tanda tangan belum dapat dikonfirmasi.",
    );
  if (!existing) {
    progress("sheets_write");
    await batch([
      append(ids.SIGNATURE_METADATA, [
        id,
        actor.id,
        "",
        new Date().toISOString(),
        name,
        hash,
      ]),
      audit(ids, actor, "UPLOAD_SIGNATURE", id, null, { id }),
    ]);
  }
  progress("verification");
  const confirmed = (await rows("SIGNATURE_METADATA")).find(
    (r) => r[0] === id && r[1] === actor.id && r[4] === name && r[5] === hash,
  );
  if (!confirmed)
    throw new FeatureUnavailable(
      "SIGNATURE_PERSISTENCE_UNCONFIRMED",
      "Referensi tanda tangan belum terverifikasi. Coba lagi dengan isian yang sama.",
    );
  return id;
}
