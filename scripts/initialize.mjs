import { spawnSync } from "node:child_process";
if (process.argv.includes("--admin"))
  throw new Error(
    "Bootstrap password lama dinonaktifkan untuk instalasi baru. Gunakan Google register lalu users:admin bootstrap. Akun lama tetap didukung selama migrasi.",
  );
const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "scripts/users-admin.ts",
    "init-app",
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
