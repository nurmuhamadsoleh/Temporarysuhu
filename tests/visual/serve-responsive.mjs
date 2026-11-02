// Local UI review only. Never included in the Next.js application.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
const out = new URL("../../.npm-cache/responsive-visual/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["tests/visual/ResponsivePreview.tsx"],
  outfile: fileURLToPath(new URL("preview.js", out)),
  bundle: true,
  alias: {
    "next/navigation": "./tests/visual/preview-navigation.tsx",
    "next/link": "./tests/visual/preview-navigation.tsx",
    "next-auth/react": "./tests/visual/preview-navigation.tsx",
  },
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
const cssPath = new URL("../../src/app/globals.css", import.meta.url);
const css = await postcss([tailwind()]).process(
  await readFile(cssPath, "utf8"),
  { from: fileURLToPath(cssPath) },
);
await writeFile(new URL("preview.css", out), css.css);
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/signatures/")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="100"><text x="12" y="50" fill="#334155">UI TEST SIGNATURE</text></svg>',
    );
    return;
  }
  if (req.url?.startsWith("/api/reports/")) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([500, 700])
      .drawText("UI TEST PREVIEW - NOT AN OPERATIONAL REPORT", {
        x: 24,
        y: 650,
        size: 12,
        font,
      });
    res.setHeader("Content-Type", "application/pdf");
    res.end(Buffer.from(await doc.save()));
    return;
  }
  if (req.url === "/preview.js" || req.url === "/preview.css") {
    res.setHeader(
      "Content-Type",
      req.url.endsWith("js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(new URL(req.url.slice(1), out)));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preview.css"><title>TempControl Responsive UI Test</title></head><body><div id="root"></div><script src="/preview.js"></script></body></html>',
  );
});
server.listen(3102, "127.0.0.1", () =>
  console.log("UI fixture: http://127.0.0.1:3102"),
);
