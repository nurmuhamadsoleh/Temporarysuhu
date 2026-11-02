const raw = process.argv[2] || process.env.AUTH_URL;
async function main() {
  if (!raw) throw new Error("ORIGIN_REQUIRED");
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error("HTTPS_ORIGIN_REQUIRED");
  const checks = [
    ["/login", 200],
    ["/register", 200],
    ["/api/health", 200],
    ["/api/health/ready", 200],
    ["/api/auth/providers", 200],
    ["/api/users", 401],
  ];
  let failed = false;
  for (const [path, expected] of checks) {
    try {
      const r = await fetch(u.origin + path, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      let ok = r.status === expected;
      if (path === "/api/auth/providers" && ok) {
        const data = await r.json();
        ok =
          data.google?.callbackUrl === `${u.origin}/api/auth/callback/google` &&
          new URL(data.google.signinUrl).origin === u.origin;
      }
      if (path === "/api/health" && ok) {
        const data = await r.json();
        ok = data.service === "tempcontrol" && data.status === "alive";
      }
      if (path === "/api/health/ready" && ok) {
        const data = await r.json();
        ok = data.service === "tempcontrol" && data.status === "ready";
      }
      console.log(JSON.stringify({ path, status: r.status, passed: ok }));
      failed ||= !ok;
    } catch (error) {
      console.log(
        JSON.stringify({
          path,
          passed: false,
          code: error.cause?.code || error.name,
        }),
      );
      failed = true;
    }
  }
  if (failed) {
    process.exitCode = 1;
    console.log("PRODUCTION_NOT_VERIFIED");
  } else
    console.log(
      "PUBLIC_ENDPOINTS_VERIFIED; lanjutkan pengujian OAuth, role dan PDF dengan akun organisasi.",
    );
}
main().catch(() => {
  console.error("PROBE_FAILED: berikan origin HTTPS yang valid");
  process.exitCode = 1;
});
