vi.mock("@/lib/server/report-data", () => ({
  buildTemperatureReportData: async (report: unknown) => report,
}));
import { it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/server/errors";
const m = vi.hoisted(() => ({
  role: "PETUGAS",
  logged: true,
  data: vi.fn(),
  create: vi.fn(),
  verify: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireActor: async (allowed?: string[]) => {
    if (!m.logged) throw new AppError(401, "Silakan login");
    if (allowed && m.role !== "SUPER_ADMIN" && !allowed.includes(m.role))
      throw new AppError(403, "Akses ditolak");
    return { id: "actor", name: "Actor", role: m.role };
  },
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
  getFile: vi.fn(),
}));
vi.mock("@/lib/server/sheets", () => ({ rows: vi.fn() }));
vi.mock("@/lib/server/reports", () => ({
  report: vi.fn(),
  createControlReport: m.create,
  certificateConfigured: () => false,
}));
vi.mock("@/lib/server/control-records", () => ({
  getControlData: m.data,
  controlSettings: m.config,
  saveControlSettings: vi.fn(),
  createCorrection: m.create,
  verifyCorrection: m.verify,
  checkControlFresh: vi.fn(),
}));
import {
  previewControl,
  addCorrection,
  approveCorrection,
  saveControl,
  updateControlSettings,
} from "@/lib/server/control-api";
const headers = {
  "Content-Type": "application/json",
  Origin: "http://localhost:3000",
  "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.role = "PETUGAS";
  m.logged = true;
  m.data.mockResolvedValue({ report: { readings: [] } });
});
it("requires session before reading source data", async () => {
  m.logged = false;
  expect(
    (
      await previewControl(
        new Request("http://localhost:3000/api/reports/control"),
      )
    ).status,
  ).toBe(401);
  expect(m.data).not.toHaveBeenCalled();
});
it("never grants verification/configuration permission based on a frontend role", async () => {
  const request = new Request(
    "http://localhost:3000/api/reports/control/corrections/x/verify",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ version: "v", role: "SUPER_ADMIN" }),
    },
  );
  expect(
    (
      await approveCorrection(request, {
        params: Promise.resolve({ id: crypto.randomUUID() }),
      })
    ).status,
  ).toBe(403);
  expect(m.verify).not.toHaveBeenCalled();
  expect(
    (
      await updateControlSettings(
        new Request("http://localhost:3000/api/reports/control/config", {
          method: "PATCH",
          headers,
          body: "{}",
        }),
      )
    ).status,
  ).toBe(403);
});
it("validates filters and rejects injected actor fields in corrective actions", async () => {
  expect(
    (
      await previewControl(
        new Request(
          "http://localhost:3000/api/reports/control?kind=freezer&deviceNumber=10001&month=11&year=2026",
        ),
      )
    ).status,
  ).toBe(400);
  const response = await addCorrection(
    new Request("http://localhost:3000/api/reports/control/corrections", {
      method: "POST",
      headers,
      body: JSON.stringify({
        recordId: crypto.randomUUID(),
        deviceType: "chiller",
        deviceNumber: 1,
        date: "2026-11-01",
        time: "07:00",
        description: "test",
        performedBy: "forged",
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
it("reports a Sheets failure instead of returning a successful preview", async () => {
  m.data.mockRejectedValue(new AppError(503, "Google Sheets tidak tersedia"));
  const response = await previewControl(
    new Request(
      "http://localhost:3000/api/reports/control?kind=chiller&deviceNumber=1&month=11&year=2026",
    ),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).success).toBe(false);
});
it("requires an idempotency key for saved control reports", async () => {
  const response = await saveControl(
    new Request("http://localhost:3000/api/reports/control", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { kind: "chiller", deviceNumber: 1, month: 11, year: 2026 },
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
