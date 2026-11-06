import { it, expect, vi } from "vitest";
vi.mock("@/lib/server/auth", () => ({
  requireActor: async () => ({ id: "actor", role: "PETUGAS" }),
  rateLimit: async () => {},
}));
vi.mock("@/lib/server/sheets", () => ({
  allRecords: async () => [
    {
      id: "record",
      kind: "freezer",
      date: "2026-11-05",
      time: "03:00",
      values: [-18, -13.5],
      deviceRefs: [
        { id: "one", number: 1 },
        { id: "seven", number: 7 },
      ],
      officer: "Operator",
      status: "NORMAL",
      notes: "",
    },
  ],
}));
vi.mock("@/lib/server/reports", () => ({ createReport: vi.fn() }));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
}));
import { POST } from "@/app/api/reports/export/route";
it("exports actual device numbers and decimal values beyond the legacy columns", async () => {
  const response = await POST(
    new Request("http://localhost:3000/api/reports/export", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ format: "csv", filters: {} }),
    }),
  );
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).toContain('"Suhu 7"');
  expect(csv).toContain('"-13.5"');
  expect(csv).not.toContain("°C");
  expect(csv).not.toContain('"Suhu 2"');
});
