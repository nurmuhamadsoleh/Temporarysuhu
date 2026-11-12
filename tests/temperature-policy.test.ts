import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPERATURE_POLICY as policy,
  getTemperatureStatus,
  validateDeviceInputs,
  emptyDeviceInput,
  policyBoundsSchema,
} from "@/lib/temperature-policy";
describe("Shared temperature policy", () => {
  it.each([
    [0, "NORMAL"],
    [4, "NORMAL"],
    [4.1, "WARNING"],
    [5, "WARNING"],
    [5.1, "HIGH_TEMPERATURE"],
    [-0.1, "LOW_TEMPERATURE"],
    [null, "UNFILLED"],
  ] as const)("Chiller %s: %s", (value, code) =>
    expect(getTemperatureStatus("chiller", value, policy).code).toBe(code),
  );
  it("compares decimal boundaries in tenths", () =>
    expect(getTemperatureStatus("chiller", 4 + 0.1, policy).code).toBe(
      "WARNING",
    ));
  it("never borrows Chiller SOP for Freezer", () => {
    expect(
      getTemperatureStatus("freezer", -18.5, { ...policy, freezer: null }).code,
    ).toBe("UNKNOWN_SOP");
    expect(getTemperatureStatus("freezer", null, policy).code).toBe("UNFILLED");
    const freezer = {
      ...policy,
      freezer: { min: -22, max: -18, warningMax: -17 },
    };
    expect(getTemperatureStatus("freezer", -18.5, freezer).code).toBe("NORMAL");
    expect(getTemperatureStatus("freezer", -17.3, freezer).code).toBe(
      "WARNING",
    );
    expect(getTemperatureStatus("freezer", -16.9, freezer).code).toBe(
      "HIGH_TEMPERATURE",
    );
  });
  it("requires abnormal corrections, permits missing reasons and preserves zero as filled", () => {
    const devices = Array.from({ length: 5 }, emptyDeviceInput);
    const errors = validateDeviceInputs(
      "chiller",
      [0, 4.1, 5.1, -0.1, null],
      devices,
      policy,
    );
    expect(errors.map((e) => e.deviceNumber)).toEqual([3, 4]);
    expect(
      validateDeviceInputs("freezer", [-15.5], [emptyDeviceInput()], policy),
    ).toEqual([]);
  });
  it("does not infer a completed action from a temperature status", () => {
    const device = {
      ...emptyDeviceInput(),
      correctiveAction: "DATA UJI: suhu perlu diperiksa",
      performedBy: "Petugas Uji",
      actionStatus: "SELESAI" as const,
    };
    expect(validateDeviceInputs("chiller", [5.1], [device], policy)).toEqual(
      [],
    );
    expect(getTemperatureStatus("chiller", 5.1, policy).code).toBe(
      "HIGH_TEMPERATURE",
    );
  });
  it("validates ranges and decimal SOP precision", () => {
    expect(
      policyBoundsSchema.safeParse({
        chiller: { min: 0, max: 4, warningMax: 3 },
        freezer: null,
      }).success,
    ).toBe(false);
    expect(
      policyBoundsSchema.safeParse({
        chiller: policy.chiller,
        freezer: { min: -22, max: -18.55, warningMax: null },
      }).success,
    ).toBe(false);
  });
  it("allows an unassigned Pending note without pretending that action was performed", () => {
    const pending = {
      ...emptyDeviceInput(),
      correctiveAction: "DATA UJI: menunggu penanganan",
    };
    expect(validateDeviceInputs("chiller", [5.1], [pending], policy)).toEqual(
      [],
    );
    expect(
      validateDeviceInputs(
        "chiller",
        [5.1],
        [{ ...pending, actionStatus: "SELESAI" }],
        policy,
      )[0].message,
    ).toContain("Dilakukan Oleh");
  });
});
