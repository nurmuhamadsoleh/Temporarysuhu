import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { spawn } from "node:child_process";
import {
  validateAuthEnvironment,
  ConfigurationError,
} from "../src/lib/server/runtime-config.mjs";
import { startupDiagnostic } from "../src/lib/server/startup-diagnostics.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
process.env.NODE_ENV = "production";
loadEnvConfig(root, false, {
  info() {},
  error() {
    console.error("ENV_LOAD_FAILED");
  },
});
try {
  const config = validateAuthEnvironment();
  process.env.APP_ENV = config.APP_ENV;
  delete process.env.NEXT_PHASE;
  process.env.AUTH_URL = config.origin;
  if (config.googleId) process.env.AUTH_GOOGLE_ID = config.googleId;
  if (config.googleSecret) process.env.AUTH_GOOGLE_SECRET = config.googleSecret;
  process.env.NEXTAUTH_URL = config.origin;
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/next/dist/bin/next"),
      "start",
      ...process.argv.slice(2),
    ],
    { cwd: root, stdio: "inherit", env: process.env, windowsHide: true },
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("START_FAILED");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  startupDiagnostic(
    "authentication",
    "failed",
    "AUTH_CONFIG_INVALID",
    "CRITICAL",
    error instanceof ConfigurationError ? error.fields : [],
  );
  console.error(
    error instanceof Error && error.name === "ConfigurationError"
      ? error.message
      : "STARTUP_CONFIG_FAILED",
  );
  process.exitCode = 1;
}
