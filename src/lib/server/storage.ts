import "server-only";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
export const storageRoot = () => {
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
export async function locked<T>(fn: () => Promise<T>): Promise<T> {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, {
    lockfilePath: path.join(root, ".mutation.lock"),
    retries: { retries: 20, minTimeout: 100, maxTimeout: 500 },
    stale: 120000,
    update: 10000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
export async function putFile(name: string, data: Buffer | string) {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const tmp = path.join(root, `${name}.${crypto.randomUUID()}.tmp`);
  await writeFile(tmp, data, { mode: 0o600, flag: "wx" });
  await rename(tmp, path.join(/* turbopackIgnore: true */ root, name));
}
export async function getFile(name: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Invalid file");
  return readFile(
    /* turbopackIgnore: true */ path.join(
      /* turbopackIgnore: true */ storageRoot(),
      name,
    ),
  );
}
