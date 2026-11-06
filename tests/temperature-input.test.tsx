import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTemperatureText } from "@/lib/temperature-input";
import { TemperatureInputField } from "@/components/temperature/TemperatureInputField";
import {
  DEFAULT_TEMPERATURE_POLICY,
  getTemperatureStatus,
} from "@/lib/temperature-policy";
import {
  defaultDevices,
  DEFAULT_CHILLER_COUNT,
  DEFAULT_FREEZER_COUNT,
  measurementIndex,
  measurementValue,
} from "@/lib/devices";
import type { Measurement } from "@/lib/domain";
it.each([
  ["3,1", "chiller", 3.1],
  ["3.1", "chiller", 3.1],
  ["4,5", "chiller", 4.5],
  ["-15,5", "freezer", -15.5],
  ["-15.5", "freezer", -15.5],
  ["-18", "freezer", -18],
  ["0", "chiller", 0],
  ["", "freezer", null],
  [" ", "chiller", null],
] as const)(
  "parses %s as a numeric value without Celsius suffix",
  (text, kind, value) =>
    expect(parseTemperatureText(text, kind)).toEqual({ valid: true, value }),
);
it.each([
  "-",
  "3,",
  "3.",
  "word",
  "Infinity",
  "NaN",
  "3,14",
  "1e2",
  "2°C",
  "1.2.3",
  "+3",
  "--15",
])("rejects/incompletely classifies %s", (text) =>
  expect(parseTemperatureText(text, "chiller").valid).toBe(false),
);
it.each([
  ["14.1", "chiller"],
  ["-2.1", "chiller"],
  ["-22.1", "freezer"],
  ["-5.9", "freezer"],
] as const)("enforces %s range", (text, kind) =>
  expect(parseTemperatureText(text, kind).valid).toBe(false),
);
it("uses approved default counts with stable identities", () => {
  expect(DEFAULT_CHILLER_COUNT).toBe(5);
  expect(DEFAULT_FREEZER_COUNT).toBe(6);
  expect(defaultDevices("freezer")).toHaveLength(6);
  expect(defaultDevices("freezer")).toEqual(defaultDevices("freezer"));
});
it("renders Ant Design Basic Input with readable Celsius suffix and decimal keyboard", () => {
  const html = renderToStaticMarkup(
    <TemperatureInputField
      id="stable-device"
      deviceType="freezer"
      deviceNumber={7}
      value="-15,5"
      status={getTemperatureStatus(
        "freezer",
        -15.5,
        DEFAULT_TEMPERATURE_POLICY,
      )}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("ant-input");
  expect(html).toContain("ant-input-suffix");
  expect(html).toContain("°C");
  expect(html).toContain('inputMode="decimal"');
  expect(html).toContain('value="-15,5"');
  expect(html).toContain("NORMAL");
  expect(html).not.toContain("ant-slider");
});
it("preserves incomplete edit text without a false temperature status", () => {
  const html = renderToStaticMarkup(
    <TemperatureInputField
      id="draft"
      deviceType="chiller"
      deviceNumber={8}
      value="3,"
      status={null}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('value="3,"');
  expect(html).toContain("LENGKAPI NILAI SUHU");
  expect(html).not.toContain(">NORMAL<");
});
it("finds compact readings by stable device number despite gaps", () => {
  const r = {
    kind: "freezer",
    values: [-13.5, -7.9],
    deviceRefs: [
      { id: "id1", number: 1 },
      { id: "id7", number: 7 },
    ],
  } as Measurement;
  expect(measurementIndex(r, 7)).toBe(1);
  expect(measurementValue(r, 7)).toBe(-7.9);
  expect(measurementValue(r, 2)).toBeUndefined();
});
