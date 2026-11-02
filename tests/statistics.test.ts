import { it, expect } from "vitest";
import { getTemperatureStatistics } from "@/lib/server/sheets";
import type { Measurement } from "@/lib/domain";
it("counts out-of-limit sensor readings rather than measurement rows", () => {
  const records = [
    { kind: "chiller", values: [0, 2, 4, 6, 8], status: "NORMAL" },
  ] as Measurement[];
  const stats = getTemperatureStatistics(records, {
    chiller: { min: 0, max: 4 },
    freezer: null,
  });
  expect(stats.chillerCount).toBe(1);
  expect(stats.alerts).toBe(2);
  expect(stats.chillerAverage).toBe(4);
});
