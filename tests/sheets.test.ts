const signatureBytes = Buffer.from("fixture signature file");
const signatureHash = createHash("sha256").update(signatureBytes).digest("hex");
import { emptyDeviceInput } from "@/lib/temperature-policy";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
vi.mock("@/lib/server/storage", () => ({
  getFile: async () => Buffer.from("fixture signature file"),
}));
const testPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  values: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        get: mocks.get,
        batchUpdate: mocks.batch,
        values: { get: mocks.values },
      },
    }),
  },
}));
import {
  cells,
  decode,
  ensureSheetHeaders,
  headers,
  createTemperatureRecord,
} from "@/lib/server/sheets";
const actor = {
  id: "actor",
  name: "Petugas",
  email: "p@example.test",
  role: "PETUGAS" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_SPREADSHEET_ID = "test-spreadsheet-identifier";
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.test";
  process.env.GOOGLE_PRIVATE_KEY = testPrivateKey;
  mocks.get.mockResolvedValue({
    data: {
      sheets: Object.keys(headers).map((title, sheetId) => ({
        properties: { title, sheetId },
      })),
    },
  });
  mocks.batch.mockResolvedValue({});
  mocks.values.mockImplementation(({ range }: { range: string }) => {
    const name = range.split("'")[1];
    return Promise.resolve({ data: { values: [headers[name]] } });
  });
});
describe("Sheets API", () => {
  it.each(["chiller", "freezer"] as const)(
    "saves %s decimals as NUMBER and verifies the same values on readback",
    async (kind) => {
      const input = {
        date: "2026-10-31",
        time: "12:00",
        values:
          kind === "chiller"
            ? [0, 1.8, 2.3, 4.7, 6.9]
            : [-18.5, -20.7, -17.3, -19.8],
        notes: "",
        signatureId: crypto.randomUUID(),
      };
      Object.assign(input, {
        devices: input.values.map((v) => ({
          ...emptyDeviceInput(),
          ...((kind === "chiller" && v > 5) ||
          (kind === "freezer" && (v < -18 || v > -8))
            ? {
                correctiveAction: "DATA UJI pemeriksaan",
                performedBy: "Pelaksana Uji",
              }
            : {}),
        })),
      });
      const sheet = kind === "chiller" ? "Suhu Chiller" : "Suhu Freezer";
      let stored: unknown[] | undefined;
      let meta: unknown[] | undefined;
      mocks.values.mockImplementation(({ range }: { range: string }) => {
        const name = range.split("'")[1];
        const extra =
          name === "SIGNATURE_METADATA"
            ? [
                [
                  input.signatureId,
                  actor.id,
                  "",
                  "at",
                  input.signatureId + ".png",
                  signatureHash,
                ],
              ]
            : name === "TEMPERATURE_DEVICE_STATES" && meta
              ? [meta]
              : name === sheet && stored
                ? [stored]
                : [];
        return Promise.resolve({ data: { values: [headers[name], ...extra] } });
      });
      mocks.batch.mockImplementation(({ requestBody }) => {
        const row = requestBody.requests[0].appendCells.rows[0].values;
        expect(
          row
            .slice(3, 3 + input.values.length)
            .map(
              (cell: { userEnteredValue: unknown }) => cell.userEnteredValue,
            ),
        ).toEqual(input.values.map((numberValue) => ({ numberValue })));
        stored = row.map(
          (cell: {
            userEnteredValue: { numberValue?: number; stringValue?: string };
          }) =>
            cell.userEnteredValue.numberValue ??
            cell.userEnteredValue.stringValue,
        );
        const metadataRequest = requestBody.requests.find(
          (r: { appendCells?: { sheetId: number } }) =>
            r.appendCells?.sheetId ===
            Object.keys(headers).indexOf("TEMPERATURE_DEVICE_STATES"),
        );
        if (metadataRequest)
          meta = metadataRequest.appendCells.rows[0].values.map(
            (c: {
              userEnteredValue?: { numberValue?: number; stringValue?: string };
            }) =>
              c.userEnteredValue?.numberValue ??
              c.userEnteredValue?.stringValue ??
              "",
          );
        return Promise.resolve({});
      });
      const result = await createTemperatureRecord(
        kind,
        input,
        actor,
        "decimal-key",
        "hash",
      );
      expect(result.values).toEqual(input.values);
      expect(mocks.values).toHaveBeenCalledWith(
        expect.objectContaining({ valueRenderOption: "UNFORMATTED_VALUE" }),
      );
    },
  );
  it("writes temperature as NUMBER and formula-looking text as literal strings", () => {
    expect(cells([1.8, '=IMPORTXML("evil")'])).toEqual([
      { userEnteredValue: { numberValue: 1.8 } },
      { userEnteredValue: { stringValue: '=IMPORTXML("evil")' } },
    ]);
  });
  it("preserves decimal numeric readback and rejects locale strings", () => {
    const row = [
      "id",
      "2026-10-31",
      "12:00",
      -18.5,
      -20.7,
      -18,
      -6,
      "Petugas",
      "sig",
      "NORMAL",
      "",
      "now",
      "now",
      "actor",
      "actor",
    ];
    expect(decode("freezer", row).values).toEqual([-18.5, -20.7, -18, -6]);
    row[3] = "-18,5";
    expect(() => decode("freezer", row)).toThrow("NUMBER");
  });
  it("never overwrites mismatched headers", async () => {
    mocks.values.mockResolvedValue({ data: { values: [["LEGACY", "DATA"]] } });
    await expect(ensureSheetHeaders()).rejects.toThrow("tidak cocok");
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("does not write when schemas already match", async () => {
    await ensureSheetHeaders();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("returns existing record for idempotent retry without another write", async () => {
    const input = {
      date: "2026-10-31",
      time: "12:00",
      values: [0, 2, 4, 6, 8],
      notes: "",
      signatureId: crypto.randomUUID(),
    };
    mocks.values.mockImplementation(({ range }: { range: string }) => {
      const name = range.split("'")[1];
      const extra =
        name === "AUDIT_LOG"
          ? [
              [
                "audit",
                "at",
                actor.id,
                "CREATE",
                "record",
                "",
                "",
                "key",
                "hash",
              ],
            ]
          : name === "Suhu Chiller"
            ? [
                [
                  "record",
                  input.date,
                  input.time,
                  ...input.values,
                  actor.name,
                  input.signatureId,
                  "NORMAL",
                  "",
                  "now",
                  "now",
                  actor.id,
                  actor.id,
                ],
              ]
            : [];
      return Promise.resolve({ data: { values: [headers[name], ...extra] } });
    });
    const r = await createTemperatureRecord(
      "chiller",
      input,
      actor,
      "key",
      "hash",
    );
    expect(r.id).toBe("record");
    expect(mocks.batch).not.toHaveBeenCalled();
    await expect(
      createTemperatureRecord("chiller", input, actor, "key", "other"),
    ).rejects.toThrow("payload lain");
  });
});
