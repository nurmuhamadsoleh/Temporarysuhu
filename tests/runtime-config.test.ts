import { it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import {
  validateRuntimeEnvironment,
  authOrigin,
  validateAuthEnvironment,
  validateDatabaseEnvironment,
  validateSigningEnvironment,
  parseBooleanEnv,
} from "@/lib/server/runtime-config.mjs";
const key = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
it.each([
  [undefined, false],
  ["", false],
  ["   ", false],
  ["false", false],
  ["true", true],
  ["FALSE", false],
  ["TRUE", true],
  [" true ", true],
  [" false ", false],
])("parses optional legacy flag %j consistently", (raw, expected) => {
  expect(parseBooleanEnv(raw as string | undefined)).toBe(expected);
  expect(
    validateAuthEnvironment({
      ...valid(),
      LEGACY_CREDENTIALS_ENABLED: raw as string | undefined,
    }).LEGACY_CREDENTIALS_ENABLED,
  ).toBe(expected);
});
it.each([" invalid ", "yes", "no", '"false"', "null", "undefined", "1"])(
  "rejects explicit invalid legacy flag %j",
  (raw) => {
    expect(() => parseBooleanEnv(raw)).toThrow("LEGACY_CREDENTIALS_ENABLED");
    expect(() =>
      validateAuthEnvironment({ ...valid(), LEGACY_CREDENTIALS_ENABLED: raw }),
    ).toThrow("LEGACY_CREDENTIALS_ENABLED");
  },
);
const root = path.resolve("production-release"),
  outside = path.resolve("production-shared/private");
it("accepts an empty certificate environment when production signing is disabled", () => {
  expect(
    validateRuntimeEnvironment(
      { ...valid(), PDF_SIGNING_CERTIFICATE_ENV: "" },
      root,
    ).signing,
  ).toBe(false);
});
const valid = () => ({
  NODE_ENV: "production",
  APP_ENV: "production",
  AUTH_URL: "https://temperatursuhu.bogarasatama.com",
  NEXTAUTH_URL: "https://temperatursuhu.bogarasatama.com",
  AUTH_SECRET: "a-random-test-secret-0123456789-ABCDEF",
  AUTH_GOOGLE_ID: "123-abc.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "GOCSPX-test-fixture-secret",
  GOOGLE_SPREADSHEET_ID: "spreadsheet-test-id-12345678",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "fixture@project.iam.gserviceaccount.com",
  GOOGLE_PRIVATE_KEY: key,
  SIGNATURE_STORAGE_PROVIDER: "local",
  PRIVATE_STORAGE_PATH: outside,
  STORAGE_PERSISTENCE_CONFIRMED: "true",
  AUTH_COORDINATION_MODE: "single-host",
  LEGACY_CREDENTIALS_ENABLED: "false",
  COMPANY_NAME: "Test fixture",
  PDF_SIGNING_ENABLED: "false",
});
it("accepts separated production config without a certificate and uses production origin", () => {
  expect(validateRuntimeEnvironment(valid(), root)).toMatchObject({
    production: true,
    signing: false,
    origin: "https://temperatursuhu.bogarasatama.com",
  });
});
it("has no implicit local origin", () =>
  expect(() => authOrigin({})).toThrow("AUTH_URL"));
it.each([
  "http://temperatursuhu.bogarasatama.com",
  "https://localhost",
  "https://127.0.0.1",
  "https://example.com/path",
  "https://user:pass@example.com",
])("rejects unsafe production origin %s", (url) =>
  expect(() =>
    validateRuntimeEnvironment(
      { ...valid(), AUTH_URL: url, NEXTAUTH_URL: url },
      root,
    ),
  ).toThrow(),
);
it("rejects mismatched callback origins and development environment", () => {
  expect(() =>
    validateRuntimeEnvironment(
      { ...valid(), NEXTAUTH_URL: "https://other.example" },
      root,
    ),
  ).toThrow("NEXTAUTH_URL");
  expect(() =>
    validateRuntimeEnvironment({ ...valid(), APP_ENV: "development" }, root),
  ).toThrow("APP_ENV");
});
it("rejects missing credentials, invalid private keys and weak secrets without echoing values", () => {
  for (const [field, value] of [
    ["AUTH_GOOGLE_SECRET", ""],
    ["GOOGLE_PRIVATE_KEY", "TOP-SECRET-INVALID-KEY"],
    ["AUTH_SECRET", "short-secret"],
  ]) {
    try {
      validateRuntimeEnvironment({ ...valid(), [field]: value }, root);
      throw new Error("Expected rejection");
    } catch (error) {
      expect((error as Error).message).toContain(field);
      if (value) expect((error as Error).message).not.toContain(value);
    }
  }
});
it("rejects relative/release storage and unconfirmed persistence", () => {
  for (const location of [
    "./private-storage",
    root,
    path.join(root, "public/private"),
  ])
    expect(() =>
      validateRuntimeEnvironment(
        { ...valid(), PRIVATE_STORAGE_PATH: location },
        root,
      ),
    ).toThrow("PRIVATE_STORAGE_PATH");
  expect(() =>
    validateRuntimeEnvironment(
      { ...valid(), STORAGE_PERSISTENCE_CONFIRMED: "false" },
      root,
    ),
  ).toThrow();
});
it("does not reuse a development signing certificate implicitly", () => {
  expect(() =>
    validateRuntimeEnvironment(
      {
        ...valid(),
        PDF_SIGNING_P12_PATH: "/tmp/development.p12",
        PDF_SIGNING_P12_PASSWORD: "test",
      },
      root,
    ),
  ).not.toThrow();
  expect(() =>
    validateRuntimeEnvironment(
      {
        ...valid(),
        PDF_SIGNING_ENABLED: "true",
        PDF_SIGNING_P12_PATH: path.resolve("production-shared/cert.p12"),
        PDF_SIGNING_P12_PASSWORD: "test",
        PDF_SIGNING_CERTIFICATE_ENV: "development",
        OPENSSL_PATH: path.resolve("openssl"),
      },
      root,
    ),
  ).toThrow("PDF_SIGNING_CERTIFICATE_ENV");
});
it("allows auth-only startup without database, storage or optional PDF config", () => {
  const env = valid();
  expect(
    validateAuthEnvironment({
      NODE_ENV: env.NODE_ENV,
      AUTH_URL: env.AUTH_URL,
      AUTH_SECRET: env.AUTH_SECRET,
      AUTH_GOOGLE_ID: env.AUTH_GOOGLE_ID,
      AUTH_GOOGLE_SECRET: env.AUTH_GOOGLE_SECRET,
      LEGACY_CREDENTIALS_ENABLED: "false",
    }),
  ).toMatchObject({ APP_ENV: "production" });
});
it("supports explicit ADC without requiring a service account private key", () => {
  expect(
    validateDatabaseEnvironment({
      GOOGLE_AUTH_MODE: "adc",
      GOOGLE_SPREADSHEET_ID: "test-spreadsheet-12345678",
    }).authMode,
  ).toBe("adc");
  expect(() =>
    validateDatabaseEnvironment({
      GOOGLE_SPREADSHEET_ID: "test-spreadsheet-12345678",
    }),
  ).toThrow("GOOGLE_PRIVATE_KEY");
});
it("keeps absent optional signing disabled and uses PATH OpenSSL only when enabled", () => {
  expect(validateSigningEnvironment({ NODE_ENV: "production" }).signing).toBe(
    false,
  );
  expect(
    validateSigningEnvironment({
      ...valid(),
      PDF_SIGNING_ENABLED: "true",
      PDF_SIGNING_P12_PATH: path.resolve("../signing-test/cert.p12"),
      PDF_SIGNING_P12_PASSWORD: "test",
      PDF_SIGNING_CERTIFICATE_ENV: "production",
    }).OPENSSL_PATH,
  ).toBe("openssl");
});
it("rejects secrets exposed through public-prefixed environment variables", () =>
  expect(() =>
    validateRuntimeEnvironment(
      { ...valid(), NEXT_PUBLIC_AUTH_SECRET: "should-not-be-public" },
      root,
    ),
  ).toThrow("NEXT_PUBLIC_AUTH_SECRET"));
