import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TemperatureVerticalSlider } from "@/components/temperature/TemperatureVerticalSlider";
it("renders a vertical decimal slider with freezer bounds and localized active value", () => {
  const html = renderToStaticMarkup(
    <TemperatureVerticalSlider
      type="freezer"
      label="Suhu Freezer 1"
      value={-18.5}
      onChange={() => {}}
      sop={{ min: -22, max: -18 }}
      required
    />,
  );
  expect(html).toContain('aria-orientation="vertical"');
  expect(html).toContain('aria-valuemin="-22"');
  expect(html).toContain('aria-valuemax="-6"');
  expect(html).toContain('aria-valuenow="-18.5"');
  expect(html).toContain("-18,5°C");
  expect(html).toContain("NORMAL");
});
it("keeps zero confirmed and distinguishes it from a missing value", () => {
  const zero = renderToStaticMarkup(
    <TemperatureVerticalSlider
      type="chiller"
      label="Chiller"
      value={0}
      onChange={() => {}}
      sop={null}
    />,
  );
  expect(zero).toContain("0,0°C");
  expect(zero).toContain("NORMAL");
  expect(zero).not.toContain("Belum diisi");
  const blank = renderToStaticMarkup(
    <TemperatureVerticalSlider
      type="chiller"
      label="Chiller"
      value={null}
      onChange={() => {}}
      required
    />,
  );
  expect(blank).toContain("Belum diisi");
  expect(blank).toContain("Pilih -2,0°C");
});
it("renders configured SOP alerts and required/disabled state without inferring limits from marks", () => {
  const html = renderToStaticMarkup(
    <TemperatureVerticalSlider
      type="chiller"
      label="Chiller"
      value={6.9}
      onChange={() => {}}
      sop={{ min: 0, max: 4 }}
      disabled
      required
      error="Konfirmasi diperlukan"
    />,
  );
  expect(html).toContain("HIGH TEMPERATURE");
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('aria-required="true"');
  expect(html).toContain("Konfirmasi diperlukan");
});
