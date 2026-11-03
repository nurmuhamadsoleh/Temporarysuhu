import { describe, it, expect } from "vitest";
import {
  measurementSchema,
  normalize,
  statusFor,
  temperature,
  filterRecords,
  dateSchema,
  type Measurement,
} from "@/lib/domain";
describe("Form validation and integrity", () => {
  const base = {
    date: "2026-10-31",
    time: "09:15",
    values: [0, 2, 4, 6, 8],
    notes: "",
    signatureId: crypto.randomUUID(),
  };
  it("accepts zero as a filled field", () =>
    expect(measurementSchema("chiller").parse(base).values[0]).toBe(0));
  it("rejects empty, strings, wrong count and out-of-range values", () => {
    for (const values of [
      [],
      ["0", 2, 4, 6, 8],
      [null, 2, 4, 6, 8],
      [16, 2, 4, 6, 8],
    ])
      expect(
        measurementSchema("chiller").safeParse({ ...base, values }).success,
      ).toBe(false);
  });
  it("accepts decimal readings between visual marks", () =>
    expect(
      measurementSchema("chiller").safeParse({
        ...base,
        values: [1.8, 2, 4, 6, 8],
      }).success,
    ).toBe(true));
  it("accepts freezer decimals and rejects hundredths/unconfirmed values", () => {
    expect(
      measurementSchema("freezer").parse({
        ...base,
        values: [-18.5, -20.7, -17.3, -19.8],
      }).values,
    ).toEqual([-18.5, -20.7, -17.3, -19.8]);
    for (const value of [1.85, 14.1, -2.1, null, "1,8", undefined])
      expect(
        measurementSchema("chiller").safeParse({
          ...base,
          values: [value, 0, 2, 4, 6],
        }).success,
      ).toBe(false);
    expect(
      measurementSchema("chiller").parse({
        ...base,
        values: [1.799999999, 0.5, 2.3, 4.7, 6.9],
      }).values[0],
    ).toBe(1.8);
  });
  it("validates freezer separately", () => {
    expect(
      measurementSchema("freezer").safeParse({
        ...base,
        values: [-22, -20, -18, -6],
      }).success,
    ).toBe(true);
    expect(
      measurementSchema("freezer").safeParse({ ...base, values: [0, 2, 4, 6] })
        .success,
    ).toBe(false);
  });
  it("validates calendar and time", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(
      measurementSchema("chiller").safeParse({ ...base, time: "24:01" })
        .success,
    ).toBe(false);
  });
  it("preserves decimal readback normalization and localization", () => {
    expect(normalize(1.799999999)).toBe(1.8);
    expect(temperature(-18.5)).toBe("-18,5°C");
  });
  it("does not infer safe limits from dropdown options", () => {
    expect(statusFor([14], "chiller", { chiller: null, freezer: null })).toBe(
      "BELUM DIKONFIGURASI",
    );
    expect(
      statusFor([14], "chiller", {
        chiller: { min: 0, max: 4 },
        freezer: null,
      }),
    ).toBe("ALERT");
  });
  it("filters range and officer without altering readings", () => {
    const r = {
      ...base,
      id: "a",
      kind: "chiller",
      officer: "Soleh",
      values: [1.8],
    } as Measurement;
    expect(
      filterRecords(
        [r],
        new URLSearchParams("from=2026-10-01&to=2026-10-31&officer=soleh"),
      )[0].values[0],
    ).toBe(1.8);
    expect(filterRecords([r], new URLSearchParams("kind=freezer"))).toEqual([]);
  });
});
