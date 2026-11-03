import "server-only";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
  ConfigurationError,
  validateStorageEnvironment,
} from "./runtime-config.mjs";
import { startupDiagnostic } from "./startup-diagnostics.mjs";
import { FeatureUnavailable } from "./dependency-failure";
import { realpath, unlink } from "node:fs/promises";
export const storageRoot = () => {
  if (process.env.NODE_ENV === "production") {
    try {
      return validateStorageEnvironment().storage;
    } catch (error) {
      const fields = error instanceof ConfigurationError ? error.fields : [];
      startupDiagnostic(
        "private_storage",
        "unavailable",
        "STORAGE_CONFIG_INVALID",
        "WARNING",
        fields,
      );
      throw new FeatureUnavailable(
        "STORAGE_CONFIG_INVALID",
        "Penyimpanan privat belum dikonfigurasi dengan aman.",
        fields,
      );
    }
  }
  if (
    process.env.SIGNATURE_STORAGE_PROVIDER &&
    process.env.SIGNATURE_STORAGE_PROVIDER !== "local"
  )
    throw new Error("Unsupported private storage provider");
  return path.resolve(
    /* turbopackIgnore: true */ process.env.PRIVATE_STORAGE_PATH ||
      "./private-storage",
  );
};
function storageFailure(error: unknown): never {
  if (error instanceof FeatureUnavailable) throw error;
  const code = (error as { code?: string })?.code;
  const errorCode = ["ENOENT", "EACCES", "EROFS", "ENOSPC"].includes(code || "")
    ? `STORAGE_${code}`
    : "STORAGE_UNAVAILABLE";
  startupDiagnostic("private_storage", "unavailable", errorCode, "WARNING");
  throw new FeatureUnavailable(
    errorCode,
    "Penyimpanan privat tidak tersedia. Periksa lokasi persisten dan izin proses aplikasi.",
  );
}
async function privateDirectory(create: boolean) {
  try {
    const root = storageRoot();
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    if (process.env.NODE_ENV === "production") {
      const actual = await realpath(root),
        release = await realpath(process.cwd());
      const relative = path.relative(release, actual);
      if (
        !relative ||
        (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      )
        throw new FeatureUnavailable(
          "STORAGE_CONFIG_INVALID",
          "Storage privat tidak boleh berada dalam release atau public.",
        );
    }
    return root;
  } catch (error) {
    return storageFailure(error);
  }
}
export async function checkPrivateStorage() {
  const root = await privateDirectory(true);
  const probe = path.join(root, `.readiness-${crypto.randomUUID()}`);
  try {
    await writeFile(probe, "storage-probe", { flag: "wx", mode: 0o600 });
    if ((await readFile(probe)).toString() !== "storage-probe")
      throw new FeatureUnavailable(
        "STORAGE_UNAVAILABLE",
        "Storage tidak dapat diverifikasi.",
      );
  } catch (error) {
    storageFailure(error);
  } finally {
    await unlink(probe).catch(() => {});
  }
  return true;
}
function filePath(name: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error("Invalid file");
  return path.join(storageRoot(), name);
}
export async function locked<T>(fn: () => Promise<T>): Promise<T> {
  const root = await privateDirectory(true);
  const release = await lockfile
    .lock(root, {
      lockfilePath: path.join(root, ".mutation.lock"),
      retries: { retries: 20, minTimeout: 100, maxTimeout: 500 },
      stale: 120000,
      update: 10000,
    })
    .catch(storageFailure);
  try {
    return await fn();
  } finally {
    await release();
  }
}
export async function putFile(name: string, data: Buffer | string) {
  const destination = filePath(name);
  const root = await privateDirectory(true);
  const tmp = path.join(root, `${name}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(tmp, data, { mode: 0o600, flag: "wx" });
    await rename(tmp, /* turbopackIgnore: true */ destination);
  } catch (error) {
    storageFailure(error);
  }
}
export async function getFile(name: string) {
  const file = filePath(name);
  await privateDirectory(false);
  return readFile(/* turbopackIgnore: true */ file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    return storageFailure(error);
  });
}
