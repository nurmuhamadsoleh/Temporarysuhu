import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security/headers";
import { proxy } from "@/proxy";
import { readJson } from "@/lib/server/body";
import { getFile, putFile } from "@/lib/server/storage";

afterEach(() => vi.unstubAllEnvs());
describe("Security request boundaries", () => {
  it.each(["__proto__", "constructor", "prototype"])(
    "rejects nested %s keys before application processing",
    async (key) => {
      const body = `{"safe":[{"${key}":{"polluted":true}}]}`;
      await expect(
        readJson(new Request("http://local.test", { method: "POST", body })),
      ).rejects.toMatchObject({ status: 400 });
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    },
  );
  it("preserves numeric decimals and null in valid JSON", async () => {
    expect(
      await readJson(
        new Request("http://local.test", {
          method: "POST",
          body: '{"values":[1.8,-18.5,null],"reason":"not measured"}',
        }),
      ),
    ).toEqual({ values: [1.8, -18.5, null], reason: "not measured" });
  });
  it.each([
    "../secret",
    "..",
    ".",
    "a/b",
    "a\\b",
    "C:secret",
    "/etc/passwd",
    "CON.pdf",
    "nul",
  ])("rejects unsafe storage name %s for reads and writes", async (name) => {
    await expect(getFile(name)).rejects.toThrow("Invalid file");
    await expect(putFile(name, "test")).rejects.toThrow("Invalid file");
  });
  it("roundtrips server-generated storage names in a private test directory", async () => {
    const parent = path.resolve("tmp");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "security-storage-"));
    vi.stubEnv("PRIVATE_STORAGE_PATH", root);
    try {
      const name = `${crypto.randomUUID()}.png`;
      await putFile(name, Buffer.from("test-only"));
      expect((await getFile(name)).toString()).toBe("test-only");
    } finally {
      if (path.dirname(root) !== parent)
        throw new Error("Unexpected test directory");
      await rm(root, { recursive: true, force: true });
    }
  });
});
describe("CSP", () => {
  it("allows PDF blobs and Google pictures while forbidding production script eval", () => {
    const policy = contentSecurityPolicy("randomNonce123=", false, true);
    const script = policy
      .split(";")
      .find((v) => v.trim().startsWith("script-src"))!;
    expect(script).toContain("'nonce-randomNonce123='");
    expect(script).not.toContain("unsafe-eval");
    expect(script).not.toContain("unsafe-inline");
    expect(policy).toContain("frame-src 'self' blob:");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("https://*.googleusercontent.com");
    expect(policy).toContain("upgrade-insecure-requests");
  });
  it("limits debugging eval to development and rejects nonce injection", () => {
    expect(contentSecurityPolicy("valid", true, false)).toContain(
      "'unsafe-eval'",
    );
    expect(contentSecurityPolicy("valid", true, false)).not.toContain(
      "upgrade-insecure-requests",
    );
    expect(() =>
      contentSecurityPolicy("x'; script-src *", false, true),
    ).toThrow();
  });
  it("replaces attacker-supplied nonce/CSP and uses a fresh nonce for each request", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://example.test/login", {
      headers: {
        "x-nonce": "attacker",
        "Content-Security-Policy": "script-src *",
      },
    });
    const first = proxy(request),
      second = proxy(request);
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(nonce).not.toBe("attacker");
    expect(nonce).not.toBe(second.headers.get("x-middleware-request-x-nonce"));
    expect(first.headers.get("Content-Security-Policy")).toContain(
      `'nonce-${nonce}'`,
    );
    expect(first.headers.get("Content-Security-Policy")).not.toContain(
      "unsafe-eval",
    );
  });
});
