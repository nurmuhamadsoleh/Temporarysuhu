import nextEnv from "@next/env";
import { lookup } from "node:dns/promises";
import { GOOGLE_CALLBACK_PATH } from "../src/config/app-origin.mjs";
import { STARTUP_POLICY } from "../src/lib/server/startup-diagnostics.mjs";
import {
  validateAuthEnvironment,
  ConfigurationError,
} from "../src/lib/server/runtime-config.mjs";
process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(process.cwd(), false, {
  info() {},
  error() {
    console.error("ENV_LOAD_FAILED");
  },
});
const report = {
  at: new Date().toISOString(),
  startupPolicy: STARTUP_POLICY,
  checks: [],
};
try {
  const config = validateAuthEnvironment();
  const hostname = new URL(config.origin).hostname;
  report.callbackUrl = `${config.origin}${GOOGLE_CALLBACK_PATH}`;
  report.checks.push({
    component: "authentication",
    status: "configured",
    code: "AUTH_CONFIG_VALID",
    legacyCredentialsEnabled: config.LEGACY_CREDENTIALS_ENABLED,
  });
  try {
    await lookup(hostname);
    report.checks.push({
      component: "callback_dns",
      status: "ready",
      code: "DNS_RESOLVED",
    });
  } catch {
    report.checks.push({
      component: "callback_dns",
      status: "failed",
      code: "DNS_UNAVAILABLE",
    });
  }
  try {
    const response = await fetch(
      "https://dns.google/resolve?type=A&name=" + encodeURIComponent(hostname),
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error();
    const dns = await response.json();
    report.checks.push({
      component: "public_callback_dns",
      status: dns.Status === 0 && dns.Answer?.length ? "ready" : "failed",
      code:
        dns.Status === 3
          ? "DNS_NXDOMAIN"
          : dns.Status === 0 && dns.Answer?.length
            ? "DNS_RESOLVED"
            : "DNS_UNAVAILABLE",
    });
  } catch {
    report.checks.push({
      component: "public_callback_dns",
      status: "unavailable",
      code: "DNS_PROBE_UNAVAILABLE",
    });
  }
  try {
    const response = await fetch(
      "https://accounts.google.com/.well-known/openid-configuration",
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error();
    const discovery = await response.json();
    if (
      discovery.issuer !== "https://accounts.google.com" ||
      new URL(discovery.authorization_endpoint).origin !==
        "https://accounts.google.com"
    )
      throw new Error();
    report.checks.push({
      component: "google_discovery",
      status: "ready",
      code: "GOOGLE_DISCOVERY_READY",
    });
  } catch {
    report.checks.push({
      component: "google_discovery",
      status: "failed",
      code: "GOOGLE_DISCOVERY_UNAVAILABLE",
    });
  }
} catch (error) {
  report.checks.push({
    component: "authentication",
    status: "failed",
    code: "AUTH_CONFIG_INVALID",
    fields: error instanceof ConfigurationError ? error.fields : [],
  });
}
report.ready = report.checks.every(
  (check) => check.status === "ready" || check.status === "configured",
);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
