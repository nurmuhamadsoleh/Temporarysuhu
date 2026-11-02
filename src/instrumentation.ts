export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.NODE_ENV === "production"
  ) {
    const { validateStartup } = await import("./lib/server/startup");
    await validateStartup();
  }
}
