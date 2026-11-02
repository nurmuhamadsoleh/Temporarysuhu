import { it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ requireActor: mock.actor }));
import { POST } from "@/app/api/temperatures/[kind]/route";
it("returns a consistent 403 for foreign-origin mutations", async () => {
  const r = await POST(
    new Request("http://localhost:3000/api/temperatures/chiller", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
    { params: Promise.resolve({ kind: "chiller" }) },
  );
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({
    success: false,
    data: null,
    error: { code: 403 },
  });
  expect(mock.actor).not.toHaveBeenCalled();
});
it("rejects a measurement with missing temperature before reaching Sheets", async () => {
  mock.actor.mockResolvedValue({ id: "id", role: "PETUGAS" });
  const r = await POST(
    new Request("http://localhost:3000/api/temperatures/chiller", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: "2026-10-31",
        time: "12:00",
        values: [],
        signatureId: crypto.randomUUID(),
        notes: "",
      }),
    }),
    { params: Promise.resolve({ kind: "chiller" }) },
  );
  expect(r.status).toBe(400);
});
