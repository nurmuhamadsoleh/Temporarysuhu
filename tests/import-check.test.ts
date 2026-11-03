import { afterEach, describe, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});
function fixture(config = true) {
  mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(process.cwd(), "tmp", "import-check-"));
  fixtures.push(dir);
  mkdirSync(path.join(dir, "scripts"));
  mkdirSync(path.join(dir, "src"));
  copyFileSync(
    "scripts/check-imports.mjs",
    path.join(dir, "scripts/check-imports.mjs"),
  );
  if (config)
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
        include: ["src/**/*"],
      }),
    );
  writeFileSync(path.join(dir, "src/data.ts"), "export const value = 1.8;");
  return dir;
}
function run(dir: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "scripts/check-imports.mjs")],
    { encoding: "utf8", cwd: dir, timeout: 20000 },
  );
  return { status: result.status, text: result.stdout + result.stderr };
}
describe("Source import deployment audit", { timeout: 30000 }, () => {
  it("resolves aliases and Next CSS imports without requiring baseUrl", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, "src/main.ts"),
      'import {value} from "@/data"; import "./globals.css"; export {value};',
    );
    writeFileSync(path.join(dir, "src/globals.css"), "body { margin: 0; }");
    const result = run(dir);
    expect(result).toMatchObject({ status: 0 });
    expect(result.text).toContain("2 local imports");
  });
  it("rejects a checkout missing tsconfig.json", () => {
    const result = run(fixture(false));
    expect(result.status).toBe(1);
    expect(result.text).toContain("tsconfig.json is missing");
  });
  it("reports genuinely missing modules", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, "src/main.ts"), 'import "@/missing";');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.text).toContain("cannot resolve @/missing");
  });
  it("rejects case mismatches on Windows as well as Linux", () => {
    const dir = fixture();
    writeFileSync(path.join(dir, "src/main.ts"), 'import "@/Data";');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.text).toMatch(/Case mismatch|cannot resolve/);
  });
  it("does not report success when src is excluded from the project", () => {
    const dir = fixture();
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
        include: ["other/**/*"],
      }),
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.text).toContain("No TypeScript source files found");
  });
});
