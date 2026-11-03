import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const parentRequire = createRequire(
  require.resolve("@typescript-eslint/typescript-estree"),
);
const { minimatch } = parentRequire("minimatch");

it("keeps the named matching API used by TypeScript ESLint, including dot files", () => {
  expect(typeof minimatch).toBe("function");
  expect(minimatch("file.ts", "*.ts", { dot: true })).toBe(true);
  expect(minimatch(".config.ts", "*.ts", { dot: true })).toBe(true);
  expect(minimatch("src/file.ts", "*.ts", { dot: true })).toBe(false);
  expect(minimatch("src/file.ts", "src/**/*.ts", { dot: true })).toBe(true);
  expect(minimatch("src/file.js", "src/**/*.ts", { dot: true })).toBe(false);
});
