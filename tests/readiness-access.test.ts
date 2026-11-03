import { it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), readiness: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ requireActor: m.actor }));
vi.mock("@/lib/server/feature-readiness", () => ({
  featureReadiness: m.readiness,
}));
import { GET } from "@/app/api/health/ready/route";
import { AppError } from "@/lib/server/errors";
it("does not expose diagnostics or trigger database probes to anonymous callers", async () => {
  m.actor.mockRejectedValue(new AppError(401, "Silakan login"));
  expect((await GET()).status).toBe(401);
  expect(m.readiness).not.toHaveBeenCalled();
});
it("allows an administrator to see degraded readiness without claiming healthy dependencies", async () => {
  m.actor.mockResolvedValue({ role: "ADMIN" });
  m.readiness.mockResolvedValue({
    service: "tempcontrol",
    status: "degraded",
    components: {
      google_sheets: {
        status: "unavailable",
        errorCode: "GOOGLE_SHEETS_FORBIDDEN",
      },
    },
  });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(m.actor).toHaveBeenCalledWith(["ADMIN"]);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
