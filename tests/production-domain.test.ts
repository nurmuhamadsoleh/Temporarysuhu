import { afterEach, it, expect, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/server/user-service", () => ({
  findUser: vi.fn(),
  findGoogleUser: vi.fn(),
  syncGoogleIdentity: vi.fn(),
  legacyActor: vi.fn(),
  legacyAccount: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  locked: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
}));
import {
  PRODUCTION_ORIGIN,
  PRODUCTION_GOOGLE_CALLBACK_URL,
} from "@/config/app-origin.mjs";
import {
  authOrigin,
  validateAuthEnvironment,
} from "@/lib/server/runtime-config.mjs";
import { authOptions } from "@/lib/server/auth";
const env = () => ({
  NODE_ENV: "production",
  AUTH_URL: PRODUCTION_ORIGIN,
  NEXTAUTH_URL: PRODUCTION_ORIGIN,
  AUTH_SECRET: "test-fixture-random-0123456789-ABCdef",
  AUTH_GOOGLE_ID: "123-fixture.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "GOCSPX-fixture-test-secret",
});
afterEach(() => vi.unstubAllEnvs());
it("validates the canonical production identity", () => {
  expect(validateAuthEnvironment(env()).origin).toBe(PRODUCTION_ORIGIN);
  expect(PRODUCTION_GOOGLE_CALLBACK_URL).toBe(
    "https://temperatursuhu.bogarasatama.com/api/auth/callback/google",
  );
});
it.each([
  "https://temparatursuhu.bogarasatama.com",
  "http://temperatursuhu.bogarasatama.com",
  "https://temperatursuhu.bogarasatama.com:8443",
  "https://temperatursuhu.bogarasatama.com.attacker.example",
])("rejects noncanonical production origin %s", (url) => {
  expect(() =>
    validateAuthEnvironment({ ...env(), AUTH_URL: url, NEXTAUTH_URL: url }),
  ).toThrow("AUTH_URL");
});
it("identifies a bad alias without silently falling back", () => {
  expect(() =>
    validateAuthEnvironment({
      ...env(),
      NEXTAUTH_URL: "https://temparatursuhu.bogarasatama.com",
    }),
  ).toThrow("NEXTAUTH_URL");
  expect(() =>
    validateAuthEnvironment({
      ...env(),
      AUTH_URL: undefined,
      NEXTAUTH_URL: "https://temparatursuhu.bogarasatama.com",
    }),
  ).toThrow("NEXTAUTH_URL");
  expect(
    validateAuthEnvironment({ ...env(), AUTH_URL: undefined }).origin,
  ).toBe(PRODUCTION_ORIGIN);
});
it("keeps development origin separate and normalizes the production default port", () => {
  expect(
    authOrigin({ NODE_ENV: "development", AUTH_URL: "http://localhost:3000" }),
  ).toBe("http://localhost:3000");
  expect(
    authOrigin({
      ...env(),
      AUTH_URL: "https://TEMPERATURSUHU.bogarasatama.com:443/",
    }),
  ).toBe(PRODUCTION_ORIGIN);
});
it.each([
  "/dashboard",
  "https://temparatursuhu.bogarasatama.com/dashboard",
  "//temparatursuhu.bogarasatama.com/dashboard",
])("pins the production redirect despite untrusted baseUrl %s", async (url) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_URL", PRODUCTION_ORIGIN);
  vi.stubEnv("NEXTAUTH_URL", PRODUCTION_ORIGIN);
  const result = await authOptions.callbacks!.redirect!({
    url,
    baseUrl: "https://temparatursuhu.bogarasatama.com",
  });
  expect(new URL(result).origin).toBe(PRODUCTION_ORIGIN);
  expect(result).not.toContain("temparatursuhu");
});
