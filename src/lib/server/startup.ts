import "server-only";
import { mkdir, writeFile, unlink, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { validateRuntimeEnvironment } from "./runtime-config.mjs";
import { checkSheetsAccess } from "./readiness";
import { safeLog } from "./safe-log";
export async function validateStartup() {
  try {
    const config = validateRuntimeEnvironment();
    process.env.NEXTAUTH_URL = config.origin;
    await mkdir(config.storage, { recursive: true, mode: 0o700 });
    const folder = await realpath(config.storage);
    if (config.production) {
      const root = await realpath(process.cwd()),
        rel = path.relative(root, folder);
      if (
        rel === "" ||
        (!rel.startsWith(".." + path.sep) &&
          rel !== ".." &&
          !path.isAbsolute(rel))
      )
        throw new Error("STORAGE_INSIDE_RELEASE");
    }
    const probe = path.join(folder, `.startup-${crypto.randomUUID()}`);
    await writeFile(probe, "storage-probe", { flag: "wx", mode: 0o600 });
    await unlink(probe);
    if (config.signing) {
      const { validateP12 } = await import("./reports");
      const certificate = validateP12(
        await readFile(config.PDF_SIGNING_P12_PATH!),
        config.PDF_SIGNING_P12_PASSWORD!,
      );
      if (config.production && certificate.isIssuer(certificate))
        throw new Error("SELF_SIGNED_PRODUCTION_CERTIFICATE");
      await promisify(execFile)(config.OPENSSL_PATH!, ["version"], {
        timeout: 10000,
        windowsHide: true,
      });
    }
    await checkSheetsAccess();
    safeLog("startup_ready", "READY");
    return config;
  } catch (error) {
    safeLog("startup_failed", "STARTUP_CHECK_FAILED");
    if (error instanceof Error && error.name === "ConfigurationError")
      throw error;
    throw new Error(
      "Startup tidak siap: periksa environment, storage privat, akses/header Sheets dan sertifikat/OpenSSL.",
    );
  }
}
