import { beforeEach, afterEach, it, expect, vi } from "vitest";
import sharp from "sharp";
const m = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  metadata: [] as unknown[][],
  batch: vi.fn(),
  put: vi.fn(),
  actor: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireActor: m.actor,
  rateLimit: async () => {},
}));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
  putFile: m.put,
  getFile: m.get,
}));
vi.mock("@/lib/server/sheets", () => ({
  ensureSheetHeaders: async () => ({ SIGNATURE_METADATA: 1, AUDIT_LOG: 2 }),
  rows: async () => structuredClone(m.metadata),
  batch: m.batch,
  append: (_id: number, row: unknown[]) => ({ testRow: row }),
  audit: () => ({ testAudit: true }),
}));
import { POST } from "@/app/api/signatures/route";
import { AppError } from "@/lib/server/errors";
import { FeatureUnavailable } from "@/lib/server/dependency-failure";
const req = (data: Uint8Array, mime = "image/png", key?: string) =>
  new Request("http://localhost:3000/api/signatures", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": mime,
      ...(key ? { "Idempotency-Key": key } : {}),
      "X-Temperature-Type": "chiller",
    },
    body: new Uint8Array(data),
  });
async function png(offset = 0) {
  const pixels = Buffer.alloc(200 * 100 * 3, 255);
  for (let y = 25; y < 75; y++)
    for (let x = 40 + offset; x < 160; x++)
      for (let c = 0; c < 3; c++) pixels[(y * 200 + x) * 3 + c] = 0;
  return sharp(pixels, { raw: { width: 200, height: 100, channels: 3 } })
    .png()
    .toBuffer();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.files.clear();
  m.metadata = [];
  m.actor.mockResolvedValue({
    id: "actor",
    name: "Operator",
    email: "fixture@example.test",
    role: "PETUGAS",
  });
  m.put.mockImplementation(async (name: string, data: Buffer) => {
    m.files.set(name, data);
  });
  m.get.mockImplementation(async (name: string) => {
    const data = m.files.get(name);
    if (!data) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return data;
  });
  m.batch.mockImplementation(async (commands: { testRow?: unknown[] }[]) => {
    for (const c of commands) if (c.testRow) m.metadata.push(c.testRow);
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("rejects a blank decoded PNG", async () => {
  const blank = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  expect((await POST(req(blank))).status).toBe(400);
  expect(m.put).not.toHaveBeenCalled();
});
it("rejects MIME mismatch and oversized bodies", async () => {
  expect((await POST(req(Buffer.from("not png"), "text/plain"))).status).toBe(
    400,
  );
  expect((await POST(req(Buffer.alloc(300001)))).status).toBe(413);
});
it("persists and reads back file and metadata before success", async () => {
  const res = await POST(req(await png()));
  expect(res.status).toBe(201);
  const { id } = (await res.json()).data;
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  expect(m.files.has(id + ".png")).toBe(true);
  expect(m.metadata[0][0]).toBe(id);
  expect(m.get).toHaveBeenCalledTimes(2);
});
it("reuses the same upload after an ambiguous committed response", async () => {
  const key = crypto.randomUUID(),
    data = await png(),
    commit = m.batch.getMockImplementation()!;
  m.batch.mockImplementationOnce(async (commands) => {
    await commit(commands);
    throw new FeatureUnavailable("GOOGLE_SHEETS_TIMEOUT", "unconfirmed");
  });
  expect((await POST(req(data, "image/png", key))).status).toBe(503);
  const a = await POST(req(data, "image/png", key)),
    b = await POST(req(data, "image/png", key));
  expect(a.status).toBe(201);
  expect((await a.json()).data).toEqual((await b.json()).data);
  expect(m.metadata).toHaveLength(1);
  expect(m.files.size).toBe(1);
  expect(m.batch).toHaveBeenCalledTimes(1);
  expect(m.put).toHaveBeenCalledTimes(1);
});
it("recovers a file written before the metadata request failed", async () => {
  const key = crypto.randomUUID(),
    data = await png();
  m.batch.mockRejectedValueOnce(
    new FeatureUnavailable("GOOGLE_SHEETS_FORBIDDEN", "denied"),
  );
  const failed = await POST(req(data, "image/png", key));
  expect(failed.status).toBe(503);
  expect((await failed.json()).error.reason).toBe("GOOGLE_SHEETS_FORBIDDEN");
  expect(m.metadata).toHaveLength(0);
  expect((await POST(req(data, "image/png", key))).status).toBe(201);
  expect(m.files.size).toBe(1);
  expect(m.metadata).toHaveLength(1);
});
it("rejects reuse of a key for a different signature", async () => {
  const key = crypto.randomUUID();
  expect((await POST(req(await png(), "image/png", key))).status).toBe(201);
  expect((await POST(req(await png(8), "image/png", key))).status).toBe(409);
  expect(m.metadata).toHaveLength(1);
});
it("keeps different users' upload keys in separate namespaces", async () => {
  const key = crypto.randomUUID(),
    data = await png();
  await POST(req(data, "image/png", key));
  m.actor.mockResolvedValue({ id: "other", role: "PETUGAS" });
  expect((await POST(req(data, "image/png", key))).status).toBe(201);
  expect(m.files.size).toBe(2);
  expect(m.metadata).toHaveLength(2);
});
it("does not claim success when private storage is unavailable", async () => {
  m.get.mockRejectedValue(
    new FeatureUnavailable("STORAGE_EACCES", "unavailable"),
  );
  const res = await POST(req(await png(), "image/png", crypto.randomUUID()));
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.error).toMatchObject({
    reason: "STORAGE_EACCES",
    stage: "storage",
    requestId: res.headers.get("X-Request-ID"),
  });
  expect(m.batch).not.toHaveBeenCalled();
});
it("does not claim success for missing metadata readback", async () => {
  m.batch.mockResolvedValue(undefined);
  expect((await POST(req(await png()))).status).toBe(503);
});
it("requires server authentication before storing bytes", async () => {
  m.actor.mockRejectedValue(new AppError(401, "expired"));
  expect((await POST(req(await png()))).status).toBe(401);
  expect(m.put).not.toHaveBeenCalled();
  expect(m.batch).not.toHaveBeenCalled();
});
it("logs stages with the same correlation ID without bytes, credentials or user identity", async () => {
  const res = await POST(req(await png()));
  const events = vi
    .mocked(console.info)
    .mock.calls.map(([line]) => JSON.parse(line));
  expect(events.map((e) => e.event)).toEqual(
    expect.arrayContaining([
      "TEMPERATURE_SAVE_STARTED",
      "TEMPERATURE_SAVE_VALIDATED",
      "TEMPERATURE_SAVE_STORAGE_CHECK",
      "TEMPERATURE_SAVE_SHEETS_WRITE",
      "TEMPERATURE_SAVE_COMPLETED",
    ]),
  );
  expect(
    events.every((e) => e.requestId === res.headers.get("X-Request-ID")),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(
    /fixture@example|base64|private.key|Operator/,
  );
});
