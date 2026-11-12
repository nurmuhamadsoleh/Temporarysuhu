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
  expect(DEFAULT_CHILLER_COUNT).toBe(6);
  expect(DEFAULT_FREEZER_COUNT).toBe(5);
  expect(defaultDevices("freezer")).toHaveLength(5);
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

it.each([
  [
    "-22",
    "LOW_TEMPERATURE",
    "#2563EB",
    "Suhu Freezer berada di bawah batas normal yang ditetapkan.",
  ],
  [
    "-20",
    "LOW_TEMPERATURE",
    "#2563EB",
    "Suhu Freezer berada di bawah batas normal yang ditetapkan.",
  ],
  [
    "-18.1",
    "LOW_TEMPERATURE",
    "#2563EB",
    "Suhu Freezer berada di bawah batas normal yang ditetapkan.",
  ],
  [
    "-18",
    "NORMAL",
    "#16A34A",
    "Suhu Freezer berada dalam rentang normal (-18°C sampai -10°C).",
  ],
  [
    "-15,5",
    "NORMAL",
    "#16A34A",
    "Suhu Freezer berada dalam rentang normal (-18°C sampai -10°C).",
  ],
  [
    "-10",
    "NORMAL",
    "#16A34A",
    "Suhu Freezer berada dalam rentang normal (-18°C sampai -10°C).",
  ],
  [
    "-9.9",
    "WARNING",
    "#F59E0B",
    "Suhu Freezer mulai melebihi batas normal. Lakukan pemeriksaan.",
  ],
  [
    "-8",
    "WARNING",
    "#F59E0B",
    "Suhu Freezer mulai melebihi batas normal. Lakukan pemeriksaan.",
  ],
  [
    "-7.9",
    "HIGH_TEMPERATURE",
    "#DC2626",
    "Suhu Freezer terlalu tinggi. Diperlukan pemeriksaan dan tindakan korektif.",
  ],
  [
    "-6",
    "HIGH_TEMPERATURE",
    "#DC2626",
    "Suhu Freezer terlalu tinggi. Diperlukan pemeriksaan dan tindakan korektif.",
  ],
  ["", "UNFILLED", "#64748B", "Pengukuran suhu belum dilakukan."],
] as const)(
  "shows status, border, accessible description and indicator for Freezer input %s",
  (text, code, color, description) => {
    const parsed = parseTemperatureText(text, "freezer");
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) throw Error("invalid fixture");
    const status = getTemperatureStatus(
      "freezer",
      parsed.value,
      DEFAULT_TEMPERATURE_POLICY,
    );
    expect(status.code).toBe(code);
    expect(status.description).toBe(description);
    const html = renderToStaticMarkup(
      <TemperatureInputField
        id="freezer-live"
        deviceType="freezer"
        deviceNumber={6}
        value={text}
        status={status}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Status suhu Freezer 6"');
    expect(html).toContain(description);
    expect(html).toContain("border-color:" + color);
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("lucide-thermometer");
    expect(html).not.toContain("ant-slider");
  },
);
it("uses the approved snapshot range in Freezer descriptions without changing Chiller descriptions", () => {
  const custom = {
    ...DEFAULT_TEMPERATURE_POLICY,
    version: "custom-range",
    freezer: { min: -20, max: -12, warningMax: -9 },
  };
  expect(getTemperatureStatus("freezer", -15.5, custom).description).toBe(
    "Suhu Freezer berada dalam rentang normal (-20°C sampai -12°C).",
  );
  expect(
    getTemperatureStatus("chiller", 3.1, DEFAULT_TEMPERATURE_POLICY)
      .description,
  ).toBe("Suhu penyimpanan normal.");
  const html = renderToStaticMarkup(
    <TemperatureInputField
      id="chiller-original"
      deviceType="chiller"
      deviceNumber={1}
      value="3,1"
      status={getTemperatureStatus("chiller", 3.1, DEFAULT_TEMPERATURE_POLICY)}
      onChange={() => {}}
    />,
  );
  expect(html).not.toContain("lucide-thermometer");
  const inputMarkup = html.slice(
    html.indexOf('<span class="ant-input-affix-wrapper'),
    html.indexOf('<div id="chiller-original-status"'),
  );
  expect(inputMarkup).not.toContain("border-color:");
});
it("preserves incomplete Freezer text without mislabeling it as empty or normal and prioritizes validation errors", () => {
  const html = renderToStaticMarkup(
    <TemperatureInputField
      id="incomplete-freezer"
      deviceType="freezer"
      deviceNumber={1}
      value="-15,"
      status={null}
      error="Lengkapi nilai suhu"
      onChange={() => {}}
    />,
  );
  expect(html).toContain('value="-15,"');
  expect(html).toContain("LENGKAPI NILAI SUHU");
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("border-color:#DC2626");
  expect(html).not.toContain(">BELUM DIISI<");
  expect(html).not.toContain(">NORMAL<");
});
