import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { emptyDeviceInput } from "@/lib/temperature-policy";
const m = vi.hoisted(() => ({
  actor: vi.fn(),
  create: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ requireActor: m.actor }));
vi.mock("@/lib/server/storage", () => ({ locked: m.lock }));
vi.mock("@/lib/server/sheets", () => ({
  createTemperatureRecord: m.create,
  getRecords: vi.fn(),
}));
import { POST } from "@/app/api/temperatures/[kind]/route";
import { AppError } from "@/lib/server/errors";
import { FeatureUnavailable } from "@/lib/server/dependency-failure";
const actor = {
  id: "server-user",
  name: "Verified Operator",
  role: "PETUGAS",
  email: "fixture@example.test",
};
function request(
  kind: string,
  values: (number | null)[],
  key = crypto.randomUUID(),
) {
  return new Request("http://localhost:3000/api/temperatures/" + kind, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      date: "2026-11-04",
      time: "03:00",
      values,
      devices: values.map((v) => ({
        ...emptyDeviceInput(),
        missingReason: v === null ? "Alat tidak beroperasi" : "",
      })),
      notes: "DATA UJI",
      signatureId: crypto.randomUUID(),
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue(actor);
  m.lock.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  m.create.mockImplementation(async (kind, input, who) => ({
    ...input,
    id: crypto.randomUUID(),
    kind,
    createdBy: who.id,
    officer: who.name,
  }));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it.each([
  ["chiller", [0, 1.8, 2.3, null, 4.7]],
  ["freezer", [-18.5, -20.7, null, -19.8]],
] as const)(
  "saves %s via the authenticated server identity and a stable idempotency key",
  async (kind, values) => {
    const key = crypto.randomUUID(),
      res = await POST(request(kind, [...values], key), {
        params: Promise.resolve({ kind }),
      });
    expect(res.status).toBe(201);
    expect(m.actor).toHaveBeenCalledWith(["ADMIN", "PETUGAS"]);
    const args = m.create.mock.calls[0];
    expect(args[0]).toBe(kind);
    expect(args[1].values).toEqual(values);
    expect(args[1]).not.toHaveProperty("role");
    expect(args[2]).toEqual(actor);
    expect(args[3]).toBe(key);
    const body = await res.json();
    expect(body.data.createdBy).toBe(actor.id);
    expect(body.data.officer).toBe(actor.name);
  },
);
it.each([401, 403])(
  "stops unauthorized save with %s before persistence",
  async (status) => {
    m.actor.mockRejectedValue(new AppError(status, "denied"));
    const res = await POST(request("chiller", [0, 1, 2, 3, 4]), {
      params: Promise.resolve({ kind: "chiller" }),
    });
    expect(res.status).toBe(status);
    expect(m.create).not.toHaveBeenCalled();
  },
);
it("does not reach Sheets if the shared mutation storage is unavailable", async () => {
  m.lock.mockRejectedValue(
    new FeatureUnavailable("STORAGE_CONFIG_INVALID", "unavailable"),
  );
  const res = await POST(request("freezer", [-18, -19, -20, -21]), {
    params: Promise.resolve({ kind: "freezer" }),
  });
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatchObject({
    reason: "STORAGE_CONFIG_INVALID",
    stage: "storage",
  });
  expect(m.create).not.toHaveBeenCalled();
});
it("returns safe correlated Sheets write errors instead of false success", async () => {
  m.create.mockImplementation(
    async (_kind, _input, _actor, _key, _hash, progress) => {
      progress("sheets_write");
      throw new FeatureUnavailable("GOOGLE_SHEETS_FORBIDDEN", "write denied");
    },
  );
  const res = await POST(request("chiller", [0, 1, 2, 3, 4]), {
    params: Promise.resolve({ kind: "chiller" }),
  });
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatchObject({
    reason: "GOOGLE_SHEETS_FORBIDDEN",
    stage: "sheets_write",
    requestId: res.headers.get("X-Request-ID"),
  });
  const events = vi
    .mocked(console.error)
    .mock.calls.map(([v]) => JSON.parse(v));
  expect(events.at(-1)).toMatchObject({
    event: "TEMPERATURE_SAVE_FAILED",
    category: "google_sheets",
    httpStatus: 503,
  });
  expect(JSON.stringify(events)).not.toContain("fixture@example");
});
it("rejects a missing idempotency key before creating a record", async () => {
  const req = request("chiller", [0, 1, 2, 3, 4]);
  req.headers.delete("Idempotency-Key");
  const res = await POST(req, { params: Promise.resolve({ kind: "chiller" }) });
  expect(res.status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});

it("rejects client-supplied officer or role rather than trusting it", async () => {
  const base = request("chiller", [0, 1, 2, 3, 4]);
  const payload = await base.json();
  const req = new Request(base.url, {
    method: "POST",
    headers: base.headers,
    body: JSON.stringify({
      ...payload,
      createdBy: "attacker",
      role: "SUPER_ADMIN",
    }),
  });
  const res = await POST(req, { params: Promise.resolve({ kind: "chiller" }) });
  expect(res.status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
});
