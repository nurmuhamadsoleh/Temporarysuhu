import { it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ batch: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
  requireActor: async () => ({ id: "admin", role: "ADMIN" }),
}));
vi.mock("@/lib/server/sheets", () => ({
  getSop: async () => ({ chiller: null, freezer: null }),
  rows: m.rows,
  batch: m.batch,
  ensureSheetHeaders: vi.fn(),
  append: vi.fn(),
  replace: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
}));
import { POST, GET } from "@/app/api/admin/route";
beforeEach(() => {
  vi.clearAllMocks();
});
it.each(["role", "user"])(
  "old admin endpoint cannot bypass Super Admin authorization via %s action",
  async (action) => {
    const r = await POST(
      new Request("http://localhost:3000/api/admin", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, user: { role: "SUPER_ADMIN" } }),
      }),
    );
    expect(r.status).toBe(400);
    expect(m.batch).not.toHaveBeenCalled();
  },
);
it("operational ADMIN does not receive users or global audit through old settings endpoint", async () => {
  const r = await GET();
  const body = await r.json();
  expect(body.data.users).toBeUndefined();
  expect(body.data.audit).toEqual([]);
  expect(m.rows).not.toHaveBeenCalled();
});
