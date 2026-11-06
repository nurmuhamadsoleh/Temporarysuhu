import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  actor: vi.fn(),
  get: vi.fn(),
  register: vi.fn(),
  update: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireActor: m.actor,
  rateLimit: m.limit,
}));
vi.mock("@/lib/server/sheets", () => ({
  getTemperatureDevices: m.get,
  registerTemperatureDevice: m.register,
  setTemperatureDeviceActive: m.update,
}));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
}));
import { GET, POST } from "@/app/api/devices/route";
import { PATCH } from "@/app/api/devices/[id]/route";
import { AppError } from "@/lib/server/errors";
const admin = {
  id: "server-admin",
  name: "Admin Fixture",
  email: "fixture@example.test",
  role: "SUPER_ADMIN",
};
const req = (
  path: string,
  method: string,
  body?: unknown,
  key = crypto.randomUUID(),
) =>
  new Request("http://localhost:3000" + path, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue(admin);
  m.get.mockResolvedValue([]);
  m.register.mockResolvedValue({
    id: crypto.randomUUID(),
    kind: "freezer",
    number: 7,
    active: true,
  });
  m.update.mockResolvedValue({ active: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("reads active/inactive configuration only after server authentication", async () => {
  expect(
    (await GET(req("/api/devices?includeInactive=true", "GET"))).status,
  ).toBe(200);
  expect(m.get).toHaveBeenCalledWith(true);
  m.actor.mockRejectedValue(new AppError(401, "expired"));
  m.get.mockClear();
  expect((await GET(req("/api/devices", "GET"))).status).toBe(401);
  expect(m.get).not.toHaveBeenCalled();
});
it("requires SUPER_ADMIN and uses a stable idempotency key for permanent registration", async () => {
  const key = crypto.randomUUID();
  expect(
    (
      await POST(
        req(
          "/api/devices",
          "POST",
          { kind: "freezer", expectedNumber: 7 },
          key,
        ),
      )
    ).status,
  ).toBe(201);
  expect(m.actor).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  expect(m.register).toHaveBeenCalledWith("freezer", key, admin, 7);
});
it.each([401, 403])(
  "rejects unauthorized permanent registration with %s",
  async (status) => {
    m.actor.mockRejectedValue(new AppError(status, "denied"));
    expect(
      (await POST(req("/api/devices", "POST", { kind: "freezer" }))).status,
    ).toBe(status);
    expect(m.register).not.toHaveBeenCalled();
  },
);
it("rejects injected role/number assignment and invalid idempotency keys", async () => {
  expect(
    (
      await POST(
        req("/api/devices", "POST", {
          kind: "freezer",
          number: 1,
          role: "SUPER_ADMIN",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(req("/api/devices", "POST", { kind: "freezer" }, "invalid")))
      .status,
  ).toBe(400);
  expect(m.register).not.toHaveBeenCalled();
});
it("protects activation/deactivation and forwards the version without deleting history", async () => {
  const id = crypto.randomUUID();
  expect(
    (
      await PATCH(
        req("/api/devices/" + id, "PATCH", {
          active: false,
          version: "initial-v1",
        }),
        { params: Promise.resolve({ id }) },
      )
    ).status,
  ).toBe(200);
  expect(m.actor).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  expect(m.update).toHaveBeenCalledWith(id, false, "initial-v1", admin);
});
it("rejects foreign-origin mutations before database access", async () => {
  const request = req("/api/devices", "POST", { kind: "freezer" });
  request.headers.set("origin", "https://other.example");
  expect((await POST(request)).status).toBe(403);
  expect(m.register).not.toHaveBeenCalled();
});
