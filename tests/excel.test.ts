import { it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { exportWorkbook } from "@/lib/server/excel";
it("exports numeric decimals and literal formula-like strings in a real XLSX package", () => {
  const files = unzipSync(
    exportWorkbook([
      ["Temperature", "Notes"],
      [-18.5, '=WEBSERVICE("evil")'],
      [0, "<safe & literal>"],
    ]),
  );
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  expect(sheet).toContain("<v>-18.5</v>");
  expect(sheet).toContain("<v>0</v>");
  expect(sheet).toContain('t="inlineStr"');
  expect(sheet).not.toContain("<f>");
  expect(sheet).toContain("&lt;safe &amp; literal&gt;");
  expect(files["[Content_Types].xml"]).toBeDefined();
});
