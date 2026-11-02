// Local UI review only. Never included in the Next.js application.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
const out = new URL("../../.npm-cache/temperature-visual/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["tests/visual/TemperatureSliderPreview.tsx"],
  outfile: fileURLToPath(new URL("preview.js", out)),
  bundle: true,
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
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preview.css"><title>TempControl Slider UI Test</title></head><body><div id="root"></div><script src="/preview.js"></script></body></html>',
  );
});
server.listen(3101, "127.0.0.1", () =>
  console.log("UI fixture: http://127.0.0.1:3101"),
);
