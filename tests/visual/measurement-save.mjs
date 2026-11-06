import { createRequire } from "node:module";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
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
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MeasurementForm} from './src/components/temperature/MeasurementForm';import {ControlReports} from './src/components/reports/ControlReports';const query=new URL(location.href).searchParams;const kind=query.get('kind')||'chiller';const actor={id:'fixture-user',name:'TEST ONLY Operator',email:'fixture@example.test',role:query.get('role')||'PETUGAS'};createRoot(document.getElementById('root')).render(query.get('screen')==='reports'?<ControlReports actor={actor} initialDate='2026-11-05'/>:<MeasurementForm kind={kind} actor={actor} initialSop={{chiller:{min:0,max:4},freezer:null}} initialMetadata={{date:'2026-11-05',time:'03:00'}}/>);`,
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
  version: "chiller-v1-freezer-brt-v1",
  chiller: { min: 0, max: 4, warningMax: 5 },
  freezer: { min: -18, max: -10, warningMax: -8 },
};
const defaults = (kind) =>
  Array.from({ length: kind === "chiller" ? 5 : 6 }, (_, i) => ({
    id: "default-" + kind + "-" + (i + 1),
    kind,
    number: i + 1,
    label: (kind === "chiller" ? "Chiller " : "Freezer ") + (i + 1),
    active: true,
    version: "initial-v1",
  }));
const registry = [...defaults("chiller"), ...defaults("freezer")],
  histories = { chiller: [], freezer: [] };
const css = `*{box-sizing:border-box}body{font:14px Arial;margin:16px}form,section{max-width:100%;min-width:0}fieldset{border:0;padding:0;min-width:0}label{display:block}input,textarea{max-width:100%}.temperature-input-card{margin-bottom:16px}.signature-canvas{width:100%;height:150px}.signature-wrap{width:100%;max-width:600px;border:1px solid #aaa}.form-footer{margin:20px 0}.btn{padding:12px}.table-scroll{overflow-x:auto;max-width:100%}table{min-width:600px}[role=alert]{color:#a00}`;
let productionCss = "";
if (process.env.QA_USE_PRODUCTION_CSS === "true") {
  for (const directory of [".next/static/css", ".next/static/chunks"]) {
    const names = await readdir(directory).catch(() => []);
    for (const name of names.filter((n) => n.endsWith(".css")))
      productionCss += await readFile(path.join(directory, name), "utf8");
  }
  assert.ok(
    productionCss.length > 0,
    "Production CSS must exist before visual QA",
  );
}
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
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${productionCss}\n${css}</style><div id="root"></div><script nonce="${nonce}" src="/fixture.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const artifact = process.env.QA_ARTIFACT_DIR || "dynamic-inputs";
if (!/^[a-z0-9-]+$/.test(artifact))
  throw new Error("Invalid QA artifact directory");
const output = "output/" + artifact;
await mkdir(output, { recursive: true });
await mkdir("docs/" + artifact, { recursive: true });
const result = {
  at: new Date().toISOString(),
  mode: "real dynamic form and report selector with isolated API fixtures; no production writes",
  cases: [],
};
let browser;
async function attach(page, kind, role) {
  const state = {
    mode: "success",
    uploads: [],
    saves: [],
    registrations: [],
    historyReads: 0,
  };
  await page.addInitScript(() => {
    window.qaCsp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.qaCsp.push(e.effectiveDirective),
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      method = request.method();
    if (u.pathname === "/api/devices" && method === "GET")
      return route.fulfill({
        json: {
          success: true,
          data:
            u.searchParams.get("includeInactive") === "true"
              ? registry
              : registry.filter((d) => d.active),
        },
      });
    if (u.pathname === "/api/devices" && method === "POST") {
      assert.equal(role, "SUPER_ADMIN");
      const body = request.postDataJSON(),
        id = request.headers()["idempotency-key"];
      state.registrations.push({ id, kind: body.kind });
      let saved = registry.find((d) => d.id === id);
      if (!saved) {
        const number =
          Math.max(
            ...registry
              .filter((d) => d.kind === body.kind)
              .map((d) => d.number),
          ) + 1;
        assert.equal(body.expectedNumber, number);
        saved = {
          id,
          kind: body.kind,
          number,
          label: "Freezer " + number,
          active: true,
          version: "fixture-" + number,
        };
        registry.push(saved);
      }
      return route.fulfill({
        status: 201,
        json: { success: true, data: saved },
      });
    }
    if (u.pathname.startsWith("/api/devices/") && method === "PATCH") {
      assert.equal(role, "SUPER_ADMIN");
      const device = registry.find(
          (d) => d.id === u.pathname.split("/").at(-1),
        ),
        body = request.postDataJSON();
      device.active = body.active;
      device.version = "fixture-updated";
      return route.fulfill({ json: { success: true, data: device } });
    }
    if (u.pathname === "/api/temperatures/policy")
      return route.fulfill({ json: { success: true, data: policy } });
    if (u.pathname === "/api/signatures") {
      state.uploads.push({
        key: request.headers()["idempotency-key"],
        mime: request.headers()["content-type"],
        hash: createHash("sha256")
          .update(request.postDataBuffer())
          .digest("hex"),
      });
      if (state.mode === "upload-network") return route.abort("failed");
      return route.fulfill({
        json: {
          success: true,
          data: { id: "6cb0b47b-25c9-4b42-bdc9-15434149d0a1" },
        },
      });
    }
    if (u.pathname === "/api/temperatures/" + kind && method === "GET") {
      state.historyReads++;
      return route.fulfill({ json: { success: true, data: histories[kind] } });
    }
    if (u.pathname === "/api/temperatures/" + kind && method === "POST") {
      const body = request.postDataJSON();
      state.saves.push({ key: request.headers()["idempotency-key"], body });
      if (state.mode === "measurement-network") return route.abort("failed");
      if (state.mode === "expired")
        return route.fulfill({
          status: 401,
          json: { success: false, message: "expired" },
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const record = {
        ...body,
        id: randomUUID(),
        kind,
        officer: "TEST ONLY Operator",
        status: "NORMAL",
        createdBy: "fixture-user",
        updatedBy: "fixture-user",
        createdAt: "2026-11-05T00:00:00Z",
        updatedAt: "2026-11-05T00:00:00Z",
      };
      histories[kind] = [record];
      return route.fulfill({
        status: 201,
        json: { success: true, data: record },
      });
    }
    if (u.pathname === "/api/reports/control/archive")
      return route.fulfill({ json: { success: true, data: [] } });
    if (u.pathname === "/api/reports/control/config")
      return route.fulfill({
        json: {
          success: true,
          data: {
            settings: {
              schedule: ["03:00", "07:00", "11:00", "15:00", "19:00", "23:00"],
              daysPerPage: 7,
              paper: "A4",
              operatorStyle: "name",
              correctionSopText: "",
              correctionSopApproved: false,
            },
            version: "fixture",
          },
        },
      });
    throw Error("Unexpected fixture endpoint: " + u.pathname);
  });
  return state;
}
async function draw(page) {
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + 25, b.y + 30);
  await page.mouse.down();
  await page.mouse.move(b.x + 90, b.y + 70, { steps: 10 });
  await page.mouse.up();
}
const doubleSubmit = (page) =>
  page.evaluate(() => {
    const form = document.querySelector("form");
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const kind of ["chiller", "freezer"]) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage(),
      state = await attach(page, kind, "PETUGAS");
    await page.goto(base + "/?kind=" + kind);
    const label = kind === "chiller" ? "Chiller" : "Freezer",
      count = kind === "chiller" ? 5 : 6;
    await page.waitForFunction(
      (n) => document.querySelectorAll(".temperature-input-card").length === n,
      count,
    );
    await page.waitForFunction(
      () => !document.querySelector("input[id^=temperature-]").disabled,
    );
    assert.equal(await page.getByRole("slider").count(), 0);
    assert.equal(
      await page.locator(".ant-input-suffix").filter({ hasText: "°C" }).count(),
      count,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "+ Tambah Input " + label, exact: true })
        .isDisabled(),
      true,
    );
    const first = page.getByLabel("Suhu " + label + " 1", { exact: true });
    await first.fill("-");
    await first.blur();
    await page
      .locator(".temperature-input-card")
      .first()
      .getByRole("alert")
      .waitFor();
    assert.equal(await first.inputValue(), "-");
    assert.ok(
      (
        await page.locator(".temperature-input-card").first().innerText()
      ).includes("LENGKAPI NILAI SUHU"),
    );
    if (kind === "freezer") {
      const card = page.locator(".temperature-input-card").first();
      const second = page.getByLabel("Suhu Freezer 2", { exact: true });
      const secondCard = page.locator(".temperature-input-card").nth(1);
      await second.fill("-7");
      await page
        .locator("#freezer-2-action")
        .fill("TEST ONLY retained corrective action");
      await page.locator("#freezer-2-by").fill("TEST ONLY retained performer");
      await page.locator("#freezer-2-status").click();
      await page
        .locator(".ant-select-dropdown:visible")
        .getByText("Perbaikan", { exact: true })
        .click();
      const boundaryCases = [
        ["-22", "LOW TEMPERATURE", "rgb(37, 99, 235)"],
        ["-20", "LOW TEMPERATURE", "rgb(37, 99, 235)"],
        ["-18.1", "LOW TEMPERATURE", "rgb(37, 99, 235)"],
        ["-18", "NORMAL", "rgb(22, 163, 74)"],
        ["-15,5", "NORMAL", "rgb(22, 163, 74)"],
        ["-10", "NORMAL", "rgb(22, 163, 74)"],
        ["-9.9", "WARNING", "rgb(245, 158, 11)"],
        ["-8", "WARNING", "rgb(245, 158, 11)"],
        ["-7.9", "HIGH TEMPERATURE", "rgb(220, 38, 38)"],
        ["-6", "HIGH TEMPERATURE", "rgb(220, 38, 38)"],
        ["", "BELUM DIISI", "rgb(100, 116, 139)"],
      ];
      for (const [text, label, color] of boundaryCases) {
        await first.fill(text);
        await card
          .getByRole("status")
          .getByText(label, { exact: true })
          .waitFor();
        await page.waitForFunction(
          ({ id, color }) =>
            getComputedStyle(
              document.getElementById(id).closest(".ant-input-affix-wrapper"),
            ).borderColor === color,
          { id: await first.getAttribute("id"), color },
        );
        assert.equal(await first.inputValue(), text);
        assert.ok(
          (await secondCard.getByRole("status").innerText()).includes(
            "HIGH TEMPERATURE",
          ),
        );
        assert.equal(
          await page.locator("#freezer-2-action").inputValue(),
          "TEST ONLY retained corrective action",
        );
      }
      await first.fill("-15,");
      await first.blur();
      await card.getByText("LENGKAPI NILAI SUHU", { exact: true }).waitFor();
      assert.equal(await first.inputValue(), "-15,");
      await first.fill("-15.5");
      await card.getByText("NORMAL", { exact: true }).waitFor();
      await page.waitForFunction(
        (id) =>
          !document.getElementById(id).getAttribute("aria-invalid") ||
          document.getElementById(id).getAttribute("aria-invalid") === "false",
        await first.getAttribute("id"),
      );
      assert.ok(
        (await card.getByRole("status").innerText()).includes(
          "Suhu Freezer berada dalam rentang normal (-18°C sampai -10°C).",
        ),
      );
      for (const value of ["-15.5", "-20", "-7"]) {
        await second.fill(value);
        assert.equal(
          await page.locator("#freezer-2-action").inputValue(),
          "TEST ONLY retained corrective action",
        );
        assert.equal(
          await page.locator("#freezer-2-by").inputValue(),
          "TEST ONLY retained performer",
        );
      }
      result.freezerStatusChecks = {
        boundaries: boundaryCases.length,
        borderAndBadge: true,
        descriptions: true,
        incompleteRecovery: true,
        independentDevices: true,
        correctiveActionPreserved: true,
      };
    }
    const comma = kind === "chiller" ? "3,1" : "-15,5";
    await first.fill(comma);
    await first.blur();
    await page
      .locator(".temperature-input-card")
      .first()
      .getByText("NORMAL", { exact: true })
      .waitFor();
    await page
      .getByLabel("Suhu " + label + " 2", { exact: true })
      .fill(kind === "chiller" ? "4.5" : "-9.9");
    for (let i = 3; i <= count; i++) {
      if (kind === "freezer" && i === 6) {
        await page.getByLabel("Suhu Freezer 6", { exact: true }).fill("-7,9");
        await page
          .locator("#freezer-6-action")
          .fill("TEST ONLY device 6 correction");
        await page.locator("#freezer-6-by").fill("TEST ONLY performer");
      } else
        await page
          .locator("#" + kind + "-" + i + "-reason")
          .fill("TEST ONLY missing device " + i);
    }
    await page
      .locator("textarea[name=notes]")
      .fill("TEST ONLY preserved input");
    await draw(page);
    state.mode = "upload-network";
    await doubleSubmit(page);
    await page
      .locator("[role=alert]")
      .filter({ hasText: "Koneksi ke server" })
      .waitFor();
    assert.equal(state.uploads.length, 1);
    assert.equal(state.saves.length, 0);
    assert.equal(await first.inputValue(), comma);
    await page.setViewportSize({ width: 375, height: 812 });
    state.mode = "measurement-network";
    await doubleSubmit(page);
    await page.waitForFunction(
      () => !document.querySelector("fieldset").disabled,
    );
    assert.equal(state.uploads.length, 2);
    assert.equal(state.uploads[0].key, state.uploads[1].key);
    assert.equal(state.uploads[0].hash, state.uploads[1].hash);
    assert.equal(state.saves.length, 1);
    state.mode = "expired";
    await doubleSubmit(page);
    await page
      .getByRole("link", { name: /Masuk kembali di tab baru/ })
      .waitFor();
    assert.equal(await first.inputValue(), comma);
    await page.screenshot({
      path: path.join(output, kind + "-preserved-error.png"),
      fullPage: true,
    });
    state.mode = "success";
    const reads = state.historyReads;
    await doubleSubmit(page);
    await page.getByText("1 pengukuran", { exact: false }).waitFor();
    assert.equal(state.saves.length, 3);
    assert.equal(state.saves[0].key, state.saves[2].key);
    assert.deepEqual(state.saves[0].body, state.saves[2].body);
    assert.equal(
      state.saves[2].body.values[0],
      kind === "chiller" ? 3.1 : -15.5,
    );
    assert.equal(
      state.saves[2].body.values[1],
      kind === "chiller" ? 4.5 : -9.9,
    );
    assert.equal(state.saves[2].body.values[2], null);
    if (kind === "freezer") {
      assert.equal(
        state.saves[2].body.devices[1].correctiveAction,
        "TEST ONLY retained corrective action",
      );
      assert.equal(
        state.saves[2].body.devices[1].performedBy,
        "TEST ONLY retained performer",
      );
      assert.equal(state.saves[2].body.devices[1].actionStatus, "PERBAIKAN");
    }
    assert.equal(state.saves[2].body.deviceRefs.length, count);
    assert.equal(await first.inputValue(), "");
    assert.ok(state.historyReads > reads);
    assert.deepEqual(await page.evaluate(() => window.qaCsp), []);
    await page.screenshot({
      path: path.join(output, kind + "-success.png"),
      fullPage: true,
    });
    result.cases.push({
      kind,
      defaultInputs: count,
      celsiusSuffix: true,
      commaAndDot: true,
      incompleteTextPreserved: true,
      statusLive: true,
      petugasCannotRegister: true,
      nullAndCorrectionMapping: true,
      retryKeysAndImageStable: true,
      historyRefresh: true,
      passed: true,
    });
    await context.close();
  }
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    state = await attach(page, "freezer", "SUPER_ADMIN");
  await page.goto(base + "/?kind=freezer&role=SUPER_ADMIN");
  await page.waitForFunction(
    () => !document.querySelector("input[id^=temperature-]").disabled,
  );
  const add = page.getByRole("button", {
    name: "+ Tambah Input Freezer",
    exact: true,
  });
  await add.click();
  await add.click();
  await page.getByLabel("Suhu Freezer 7", { exact: true }).fill("-13,5");
  await page.getByLabel("Suhu Freezer 8", { exact: true }).fill("-14.5");
  await page
    .locator("#freezer-8-action")
    .fill("TEST ONLY retained eighth identity");
  const id = await page
    .getByLabel("Suhu Freezer 8", { exact: true })
    .getAttribute("id");
  await page
    .getByRole("button", { name: "Hapus input freezer 7", exact: true })
    .click();
  const remaining = page.getByLabel("Suhu Freezer 7", { exact: true });
  assert.equal(await remaining.getAttribute("id"), id);
  assert.equal(await remaining.inputValue(), "-14.5");
  assert.equal(
    await page.locator("#freezer-7-action").inputValue(),
    "TEST ONLY retained eighth identity",
  );
  await page
    .getByRole("button", { name: "Daftarkan perangkat", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".temperature-input-card").length === 7,
  );
  await page.waitForFunction(
    () => !document.querySelector("fieldset").disabled,
  );
  assert.equal(state.registrations.length, 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Hapus input freezer 7", exact: true })
      .count(),
    0,
  );
  await page.reload();
  await page.getByLabel("Suhu Freezer 7", { exact: true }).waitFor();
  assert.equal(await page.locator(".temperature-input-card").count(), 7);
  for (let i = 1; i <= 7; i++)
    await page
      .getByLabel("Suhu Freezer " + i, { exact: true })
      .fill(i === 7 ? "-13,5" : "-15.5");
  await draw(page);
  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/temperatures/freezer" &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await doubleSubmit(page);
  await savedResponse;
  await page.waitForFunction(
    () =>
      !document.querySelector("fieldset").disabled &&
      document.querySelector("input[id^=temperature-]").value === "",
  );
  assert.equal(
    state.saves.at(-1).body.deviceRefs[6].id,
    state.registrations[0].id,
  );
  assert.equal(state.saves.at(-1).body.values[6], -13.5);
  await add.click();
  for (let i = 1; i <= 8; i++)
    await page
      .getByLabel("Suhu Freezer " + i, { exact: true })
      .fill(i === 8 ? "-13,5" : "-15.5");
  await draw(page);
  const automaticSave = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/temperatures/freezer" &&
      response.request().method() === "POST" &&
      response.status() === 201,
  );
  await doubleSubmit(page);
  await automaticSave;
  await page.waitForFunction(
    () =>
      !document.querySelector("fieldset").disabled &&
      document.querySelector("input[id^=temperature-]").value === "",
  );
  assert.equal(state.registrations.length, 2);
  assert.equal(
    state.saves.at(-1).body.deviceRefs[7].id,
    state.registrations[1].id,
  );
  assert.equal(state.saves.at(-1).body.values[7], -13.5);
  const eighth = page
    .locator(".temperature-input-card")
    .filter({ has: page.getByLabel("Suhu Freezer 8", { exact: true }) });
  await eighth
    .getByRole("button", { name: "Nonaktifkan perangkat", exact: true })
    .click();
  await page.locator(".ant-popconfirm-buttons .ant-btn-primary").last().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".temperature-input-card").length === 7,
  );
  await page
    .getByText("Perangkat nonaktif · histori tetap tersedia", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aktifkan Freezer 8", exact: true })
    .click();
  await page.getByLabel("Suhu Freezer 8", { exact: true }).waitFor();
  assert.equal(state.saves.length, 2);
  await page.reload();
  await page.getByLabel("Suhu Freezer 8", { exact: true }).waitFor();
  await page.getByLabel("Suhu Freezer 7", { exact: true }).fill("-15,5");
  await page.getByLabel("Suhu Freezer 8", { exact: true }).fill("-7");
  await page
    .getByRole("status", { name: "Status suhu Freezer 7", exact: true })
    .getByText("NORMAL", { exact: true })
    .waitFor();
  await page
    .getByRole("status", { name: "Status suhu Freezer 8", exact: true })
    .getByText("HIGH TEMPERATURE", { exact: true })
    .waitFor();
  result.freezerStatusChecks.additionalDevicesIndependent = true;
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (productionCss) {
      const grid = page
        .locator('section[aria-label="Input suhu Freezer"] > div.grid')
        .first();
      const columns = await grid.evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
      assert.equal(columns, width >= 1280 ? 3 : width >= 768 ? 2 : 1);
    }
    await page.screenshot({
      path: path.join(output, "dynamic-eight-" + width + ".png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  result.cases.push({
    role: "SUPER_ADMIN",
    addRemoveStableIdentity: true,
    draftRenumberKeepsValuesAndCorrections: true,
    configurationPersistsAfterReload: true,
    seventhDeviceSubmitted: true,
    automaticEighthRegistrationOnSave: true,
    deactivateReactivatePreservesHistory: true,
    productionCss: !!productionCss,
    viewports: [320, 390, 768, 1280],
    passed: true,
  });
  await page.goto(base + "/?screen=reports&role=SUPER_ADMIN");
  await page.getByLabel("Jenis laporan", { exact: false }).waitFor();
  await page.getByLabel("Jenis laporan", { exact: false }).click();
  await page.getByText("Kontrol Suhu Freezer", { exact: true }).last().click();
  await page.getByLabel("Nomor perangkat", { exact: true }).click();
  await page.getByText("Freezer 7", { exact: true }).last().waitFor();
  result.reportSelectorHasNewDevice = true;
  await context.close();
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = { name: error.name, message: error.message };
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  "docs/" + artifact + "/browser-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
