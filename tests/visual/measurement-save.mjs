import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
// Fixture-only rendering of the real form; no production auth or Sheets requests.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const nonce = "Rml4dHVyZUNzUE5vbmNl";
const fixture = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MeasurementForm} from './src/components/temperature/MeasurementForm';const kind=new URL(location.href).searchParams.get('kind')||'chiller';createRoot(document.getElementById('root')).render(<MeasurementForm kind={kind} actor={{id:'fixture-user',name:'TEST ONLY Operator',email:'fixture@example.test',role:'PETUGAS'}} initialSop={{chiller:{min:0,max:4},freezer:null}} initialMetadata={{date:'2026-11-04',time:'03:00'}}/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  plugins: [
    {
      name: "fixture-navigation",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            'export const useRouter=()=>({refresh:()=>window.dispatchEvent(new Event("fixture:router-refresh"))});',
        }));
      },
    },
  ],
});
const cspBuild = await build({
  entryPoints: ["src/lib/security/headers.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const cspModule = { exports: {} };
new Function("module", cspBuild.outputFiles[0].text)(cspModule);
const policy = {
  version: "chiller-reference-v1",
  chiller: { min: 0, max: 4, warningMax: 5 },
  freezer: null,
};
const css = `*{box-sizing:border-box}body{font:14px Arial;margin:16px}form,section{max-width:100%;min-width:0}fieldset{border:0;padding:0;min-width:0}label{display:block}input,textarea{max-width:100%}.temperature-slider-stage{height:250px;display:flex;justify-content:center;padding:20px 70px}.temperature-slider-axis{height:100%}.temperature-input-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.temperature-vertical-card{margin-bottom:16px}.signature-canvas{width:100%;height:150px}.signature-wrap{width:100%;max-width:600px;border:1px solid #aaa}.form-footer{margin:20px 0}.temperature-active-value{font-size:26px}.btn{padding:12px}table{display:block;overflow-x:auto;max-width:100%}[role=alert]{color:#a00}`;
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(fixture.outputFiles[0].text);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.setHeader(
    "Content-Security-Policy",
    cspModule.exports.contentSecurityPolicy(nonce, false, false),
  );
  res.end(
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script nonce="${nonce}" src="/fixture.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const output = "output/save";
await mkdir(output, { recursive: true });
await mkdir("docs/save", { recursive: true });
const result = {
  at: new Date().toISOString(),
  mode: "real MeasurementForm in isolated browser fixture; API responses mocked; no Google Sheets writes",
  cases: [],
};
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const kind of ["chiller", "freezer"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.name));
    await page.addInitScript(() => {
      window.fixtureViolations = [];
      window.fixtureRefresh = 0;
      document.addEventListener("securitypolicyviolation", (e) =>
        window.fixtureViolations.push(e.effectiveDirective),
      );
      window.addEventListener(
        "tempcontrol:measurements-updated",
        () => window.fixtureRefresh++,
      );
    });
    const uploads = [],
      saves = [];
    let mode = "upload-network",
      historyReads = 0,
      history = [];
    await page.route("**/api/temperatures/policy", (r) =>
      r.fulfill({ json: { success: true, data: policy } }),
    );
    await page.route("**/api/temperatures/" + kind + "?*", (r) => {
      historyReads++;
      return r.fulfill({ json: { success: true, data: history } });
    });
    await page.route("**/api/signatures", async (r) => {
      uploads.push({
        key: r.request().headers()["idempotency-key"],
        mime: r.request().headers()["content-type"],
        hasBody: !!r.request().postDataBuffer()?.length,
        fingerprint: createHash("sha256")
          .update(r.request().postDataBuffer())
          .digest("hex"),
      });
      if (mode === "upload-network") {
        await r.abort("failed");
        return;
      }
      await r.fulfill({
        json: {
          success: true,
          data: { id: "6cb0b47b-25c9-4b42-bdc9-15434149d0a1" },
        },
      });
    });
    await page.route("**/api/temperatures/" + kind, async (r) => {
      const body = r.request().postDataJSON();
      saves.push({ key: r.request().headers()["idempotency-key"], body });
      if (mode === "measurement-network") {
        await r.abort("failed");
        return;
      }
      if (mode === "expired") {
        await r.fulfill({
          status: 401,
          json: { success: false, message: "expired" },
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const record = {
        ...body,
        id: randomUUID(),
        kind,
        officer: "TEST ONLY Operator",
        status: "UNKNOWN_SOP",
        createdBy: "fixture-user",
        updatedBy: "fixture-user",
        createdAt: "2026-11-04T00:00:00Z",
        updatedAt: "2026-11-04T00:00:00Z",
      };
      history = [record];
      await r.fulfill({ status: 201, json: { success: true, data: record } });
    });
    await page.goto(base + "/?kind=" + kind);
    await page
      .getByRole("button", { name: "Simpan data", exact: true })
      .waitFor();
    const slider = page.getByRole("slider").first();
    await slider.press("Home");
    const steps = kind === "chiller" ? 38 : 35;
    for (let n = 0; n < steps; n++) await slider.press("ArrowUp");
    const count = kind === "chiller" ? 5 : 4;
    for (let i = 2; i <= count; i++)
      await page
        .locator("#" + kind + "-" + i + "-reason")
        .fill("TEST ONLY: alat tidak beroperasi");
    await page
      .locator("#" + kind + "-1-action")
      .fill("TEST ONLY pemeriksaan perangkat");
    await page.locator("#" + kind + "-1-by").fill("TEST ONLY pelaksana");
    const note = "TEST ONLY preserved form";
    await page.locator("textarea[name=notes]").fill(note);
    const canvas = page.locator("canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 25, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 95, box.y + 80, { steps: 10 });
    await page.mouse.up();
    const hasInk = () =>
      canvas.evaluate((c) => {
        const pixels = c
          .getContext("2d")
          .getImageData(0, 0, c.width, c.height).data;
        return pixels.some((v, i) => i % 4 === 3 && v > 0);
      });
    assert.equal(await hasInk(), true);
    const submit = () =>
      page.evaluate(() => {
        const form = document.querySelector("form");
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
    await submit();
    await page
      .locator("[role=alert]")
      .filter({ hasText: "Koneksi ke server" })
      .waitFor();
    assert.equal(uploads.length, 1);
    assert.equal(saves.length, 0);
    assert.equal(await page.locator("textarea[name=notes]").inputValue(), note);
    assert.equal(await hasInk(), true);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(100);
    assert.equal(await hasInk(), true);
    mode = "measurement-network";
    await submit();
    await page
      .locator("[role=alert]")
      .filter({ hasText: "Koneksi ke server" })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector("fieldset").disabled,
    );
    assert.equal(uploads.length, 2);
    assert.equal(uploads[0].key, uploads[1].key);
    assert.equal(uploads[0].fingerprint, uploads[1].fingerprint);
    assert.equal(saves.length, 1);
    assert.equal(await page.locator("textarea[name=notes]").inputValue(), note);
    mode = "expired";
    await submit();
    await page
      .getByRole("link", { name: /Masuk kembali di tab baru/ })
      .waitFor();
    assert.equal(saves.length, 2);
    assert.equal(saves[0].key, saves[1].key);
    assert.equal(await page.locator("textarea[name=notes]").inputValue(), note);
    await page.screenshot({
      path: path.join(output, kind + "-preserved-error-mobile.png"),
      fullPage: true,
    });
    mode = "success";
    const priorReads = historyReads;
    await submit();
    await page.getByText("1 pengukuran").waitFor();
    assert.equal(saves.length, 3);
    assert.equal(uploads.length, 2);
    assert.equal(saves[0].key, saves[2].key);
    assert.deepEqual(saves[0].body, saves[2].body);
    assert.equal(saves[2].body.values[0], kind === "chiller" ? 1.8 : -18.5);
    assert.equal(saves[2].body.values[1], null);
    assert.equal(await page.locator("textarea[name=notes]").inputValue(), "");
    assert.ok(historyReads > priorReads);
    assert.equal(await page.evaluate(() => window.fixtureRefresh), 1);
    assert.deepEqual(await page.evaluate(() => window.fixtureViolations), []);
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(output, kind + "-success-mobile.png"),
      fullPage: true,
    });
    result.cases.push({
      kind,
      passed: true,
      doubleSubmitBlocked: true,
      uploadRetryKeyStable: true,
      measurementRetryKeyStable: true,
      sessionErrorVisible: true,
      inputsAndSignaturePreserved: true,
      decimalAndNullPreserved: true,
      historyRefreshed: true,
      noCspViolation: true,
    });
    await context.close();
  }
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = { name: error.name, message: error.message };
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  "docs/save/browser-form-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
