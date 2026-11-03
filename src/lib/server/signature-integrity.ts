import "server-only";
import { createHash } from "node:crypto";
import { getFile } from "./storage";
import { FeatureUnavailable } from "./dependency-failure";
export async function verifySignatureFile(
  id: string,
  metadata: (string | number | boolean)[],
) {
  if (
    metadata[4] !== id + ".png" ||
    !/^[a-f0-9]{64}$/.test(String(metadata[5]))
  )
    throw new FeatureUnavailable(
      "STORAGE_SIGNATURE_INTEGRITY",
      "Referensi tanda tangan tidak dapat diverifikasi. Unggah kembali tanda tangan.",
    );
  let data: Buffer;
  try {
    data = await getFile(String(metadata[4]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    throw new FeatureUnavailable(
      "STORAGE_SIGNATURE_MISSING",
      "Berkas tanda tangan belum tersedia. Coba kembali unggahan dengan isian yang sama.",
    );
  }
  if (createHash("sha256").update(data).digest("hex") !== metadata[5])
    throw new FeatureUnavailable(
      "STORAGE_SIGNATURE_INTEGRITY",
      "Berkas tanda tangan tidak dapat diverifikasi.",
    );
}
