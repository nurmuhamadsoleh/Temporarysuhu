import { it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/server/errors";
const m = vi.hoisted(() => ({
  actor: vi.fn(),
  identity: vi.fn(),
  sync: vi.fn(),
  invite: vi.fn(),
  change: vi.fn(),
  table: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireActor: m.actor,
  requireGoogleIdentity: m.identity,
  rateLimit: async () => {},
}));
vi.mock("@/lib/server/user-service", () => ({
  userTable: m.table,
  findUser: vi.fn(),
  syncGoogleIdentity: m.sync,
  inviteUser: m.invite,
  changeUser: m.change,
}));
vi.mock("@/lib/server/sheets", () => ({ rows: vi.fn() }));
import { GET } from "@/app/api/users/route";
import { POST as register } from "@/app/api/users/register/route";
import { POST as invite } from "@/app/api/users/invite/route";
import { PATCH as role } from "@/app/api/users/[id]/role/route";
const request = (path: string, body: unknown, method = "POST") =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({ id: crypto.randomUUID(), role: "SUPER_ADMIN" });
  m.identity.mockResolvedValue({
    googleId: "verified-sub",
    email: "verified@gmail.com",
    name: "Verified",
    picture: "",
    authoritativeEmail: true,
  });
  m.sync.mockResolvedValue({
    id: crypto.randomUUID(),
    status: "PENDING",
    role: "PETUGAS",
  });
});
it("requires Super Admin on list, invitation and role management endpoints", async () => {
  m.actor.mockRejectedValue(new AppError(403, "Akses tidak diizinkan"));
  expect(
    (await GET(new Request("http://localhost:3000/api/users"))).status,
  ).toBe(403);
  expect(
    (
      await invite(
        request("/api/users/invite", {
          email: "a@gmail.com",
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await role(
        request(
          "/api/users/id/role",
          { role: "SUPER_ADMIN", version: "now" },
          "PATCH",
        ),
        { params: Promise.resolve({ id: crypto.randomUUID() }) },
      )
    ).status,
  ).toBe(403);
  expect(m.actor).toHaveBeenCalledWith(["SUPER_ADMIN"]);
  expect(m.invite).not.toHaveBeenCalled();
  expect(m.change).not.toHaveBeenCalled();
});
it("rejects registration without a verified Google identity", async () => {
  m.identity.mockRejectedValue(new AppError(401, "Verifikasi diperlukan"));
  expect((await register(request("/api/users/register", {}))).status).toBe(401);
  expect(m.sync).not.toHaveBeenCalled();
});
it("rejects frontend identity and role assignment during public registration", async () => {
  const r = await register(
    request("/api/users/register", {
      email: "attacker@gmail.com",
      googleId: "fabricated",
      role: "SUPER_ADMIN",
    }),
  );
  expect(r.status).toBe(400);
  expect(m.sync).not.toHaveBeenCalled();
});
it("registration uses only server-verified identity and checks readback response", async () => {
  const r = await register(request("/api/users/register", {}));
  expect(r.status).toBe(200);
  expect(m.sync).toHaveBeenCalledWith(
    expect.objectContaining({
      googleId: "verified-sub",
      email: "verified@gmail.com",
    }),
    true,
  );
  expect((await r.json()).data.role).toBe("PETUGAS");
});
it("does not claim success when Sheets is unavailable", async () => {
  m.sync.mockRejectedValue(new Error("Sensitive backend details"));
  const r = await register(request("/api/users/register", {}));
  expect(r.status).toBe(503);
  expect(JSON.stringify(await r.json())).not.toContain(
    "Sensitive backend details",
  );
});
