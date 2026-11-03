import { it, expect, vi } from "vitest";
import sharp from "sharp";
vi.mock("@/lib/server/auth", () => ({
  requireActor: async () => ({
    id: "actor",
    name: "Operator",
    role: "PETUGAS",
  }),
  rateLimit: async () => {},
}));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
  putFile: vi.fn(),
}));
vi.mock("@/lib/server/sheets", () => ({
  ensureSheetHeaders: async () => ({ SIGNATURE_METADATA: 1, AUDIT_LOG: 2 }),
  batch: vi.fn(),
  append: vi.fn(() => ({})),
  audit: vi.fn(() => ({})),
}));
import { POST } from "@/app/api/signatures/route";
const req = (data: Uint8Array, mime = "image/png") =>
  new Request("http://localhost:3000/api/signatures", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "Content-Type": mime },
    body: new Uint8Array(data),
  });
it("rejects a blank signature decoded by the current Sharp version", async () => {
  const blank = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  expect((await POST(req(blank))).status).toBe(400);
});
it("rejects MIME mismatch and oversized bodies", async () => {
  expect((await POST(req(Buffer.from("not png"), "text/plain"))).status).toBe(
    400,
  );
  expect((await POST(req(Buffer.alloc(300001)))).status).toBe(413);
});
it("persists a non-empty decoded PNG under a UUID reference", async () => {
  const pixels = Buffer.alloc(200 * 100 * 3, 255);
  for (let y = 25; y < 75; y++)
    for (let x = 40; x < 160; x++)
      for (let c = 0; c < 3; c++) pixels[(y * 200 + x) * 3 + c] = 0;
  const png = await sharp(pixels, {
    raw: { width: 200, height: 100, channels: 3 },
  })
    .png()
    .toBuffer();
  const res = await POST(req(png));
  expect(res.status).toBe(201);
  expect((await res.json()).data.id).toMatch(/^[a-f0-9-]{36}$/);
});
