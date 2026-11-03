import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), rows: vi.fn(), file: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
  requireActor: m.actor,
  rateLimit: async () => {},
}));
vi.mock("@/lib/server/sheets", () => ({ rows: m.rows }));
vi.mock("@/lib/server/storage", () => ({ getFile: m.file }));
import { GET } from "@/app/api/signatures/[id]/route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({ id: "owner-a", role: "PETUGAS" });
  m.rows.mockResolvedValue([[id, "owner-b", "bound-record"]]);
  m.file.mockResolvedValue(Buffer.from("test-png"));
});
it("denies another operator's signature even when bound to a measurement", async () => {
  const response = await GET(
    new Request(`http://local.test/api/signatures/${id}`),
    context,
  );
  expect(response.status).toBe(403);
  expect(m.file).not.toHaveBeenCalled();
});
it("allows an operator's own signature with no-store", async () => {
  m.rows.mockResolvedValue([[id, "owner-a", "bound-record"]]);
  const response = await GET(
    new Request(`http://local.test/api/signatures/${id}`),
    context,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("permits authorized supervisor review", async () => {
  m.actor.mockResolvedValue({ id: "reviewer", role: "SUPERVISOR" });
  expect(
    (await GET(new Request(`http://local.test/api/signatures/${id}`), context))
      .status,
  ).toBe(200);
});
