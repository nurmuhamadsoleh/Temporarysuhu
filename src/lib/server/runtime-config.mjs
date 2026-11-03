import { z } from "zod";
import path from "node:path";
import { createPrivateKey } from "node:crypto";
export class ConfigurationError extends Error {
  constructor(fields) {
    const safeFields = [...new Set(fields)].filter((field) =>
      /^[A-Z][A-Z0-9_]{0,79}$/.test(field),
    );
    super(`Konfigurasi runtime tidak valid: ${safeFields.join(", ")}`);
    this.name = "ConfigurationError";
    this.fields = safeFields;
  }
}
/** @param {string|undefined} raw */
export function parseBooleanEnv(raw, defaultValue = false) {
  if (raw === undefined || (typeof raw === "string" && !raw.trim()))
    return defaultValue;
  if (typeof raw === "string") {
    switch (raw.trim().toLowerCase()) {
      case "true":
        return true;
      case "false":
        return false;
    }
  }
  throw new ConfigurationError(["LEGACY_CREDENTIALS_ENABLED"]);
}
/** @param {Record<string,string|undefined>} env */
export function authOrigin(env = process.env) {
  const raw = env.AUTH_URL || env.NEXTAUTH_URL;
  if (!raw) throw new ConfigurationError(["AUTH_URL"]);
  try {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      throw new Error();
    return u.origin;
  } catch {
    throw new ConfigurationError(["AUTH_URL"]);
  }
}
const blank = (v) => (typeof v === "string" && !v.trim() ? undefined : v);
const value = z.preprocess(blank, z.string().min(1).optional());
/** @param {Record<string,string|undefined>} env */
export function validateRuntimeEnvironment(
  env = process.env,
  root = process.cwd(),
  scope = "all",
) {
  const auth = scope === "all" || scope === "auth";
  const database = scope === "all" || scope === "database";
  const storageFeature = scope === "all" || scope === "storage";
  const signingFeature = scope === "all" || scope === "signing";
  if (!["all", "auth", "database", "storage", "signing"].includes(scope))
    throw new Error("Invalid configuration scope");
  const production = env.NODE_ENV === "production";
  const fullSchema = z.object({
    APP_ENV: z.enum(["development", "production"]).optional(),
    AUTH_URL: value,
    NEXTAUTH_URL: value,
    AUTH_SECRET: value,
    AUTH_GOOGLE_ID: value,
    AUTH_GOOGLE_SECRET: value,
    GOOGLE_CLIENT_ID: value,
    GOOGLE_CLIENT_SECRET: value,
    GOOGLE_SPREADSHEET_ID: value,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: value,
    GOOGLE_PRIVATE_KEY: value,
    GOOGLE_AUTH_MODE: z.enum(["service-account", "adc"]).optional(),
    GOOGLE_APPLICATION_CREDENTIALS: value,
    SIGNATURE_STORAGE_PROVIDER: z.literal("local").optional(),
    PRIVATE_STORAGE_PATH: value,
    STORAGE_PERSISTENCE_CONFIRMED: z.enum(["true", "false"]).optional(),
    AUTH_COORDINATION_MODE: z.literal("single-host").optional(),
    LEGACY_CREDENTIALS_ENABLED: z
      .preprocess(blank, z.string().optional())
      .transform((raw, ctx) => {
        try {
          return parseBooleanEnv(raw, false);
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Invalid boolean environment configuration",
          });
          return z.NEVER;
        }
      }),
    INITIAL_SUPER_ADMIN_EMAIL: value,
    COMPANY_NAME: value,
    PDF_SIGNING_ENABLED: z.enum(["true", "false"]).optional(),
    PDF_SIGNING_P12_PATH: value,
    PDF_SIGNING_P12_PASSWORD: value,
    PDF_SIGNING_CERTIFICATE_ENV: z.preprocess(
      blank,
      z.enum(["development", "production"]).optional(),
    ),
    OPENSSL_PATH: value,
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
  });
  const groupFields = {
    auth: [
      "APP_ENV",
      "AUTH_URL",
      "NEXTAUTH_URL",
      "AUTH_SECRET",
      "AUTH_GOOGLE_ID",
      "AUTH_GOOGLE_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "LEGACY_CREDENTIALS_ENABLED",
      "PORT",
    ],
    database: [
      "GOOGLE_SPREADSHEET_ID",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_PRIVATE_KEY",
      "GOOGLE_AUTH_MODE",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ],
    storage: [
      "SIGNATURE_STORAGE_PROVIDER",
      "PRIVATE_STORAGE_PATH",
      "STORAGE_PERSISTENCE_CONFIRMED",
      "AUTH_COORDINATION_MODE",
    ],
    signing: [
      "PDF_SIGNING_ENABLED",
      "PDF_SIGNING_P12_PATH",
      "PDF_SIGNING_P12_PASSWORD",
      "PDF_SIGNING_CERTIFICATE_ENV",
      "OPENSSL_PATH",
    ],
  };
  const schema =
    scope === "all"
      ? fullSchema
      : fullSchema.pick(
          Object.fromEntries(groupFields[scope].map((key) => [key, true])),
        );
  const result = schema.safeParse(env);
  if (!result.success)
    throw new ConfigurationError(
      result.error.issues.map((i) => String(i.path[0])),
    );
  const v = result.data,
    errors = [];
  if (auth && production && v.APP_ENV && v.APP_ENV !== "production")
    errors.push("APP_ENV");
  if (auth && !production && v.APP_ENV === "production")
    errors.push("NODE_ENV");
  let origin;
  try {
    if (auth) origin = authOrigin(env);
  } catch {
    errors.push("AUTH_URL");
  }
  if (v.AUTH_URL && v.NEXTAUTH_URL) {
    try {
      if (authOrigin({ AUTH_URL: v.NEXTAUTH_URL }) !== origin)
        errors.push("NEXTAUTH_URL");
    } catch {
      errors.push("NEXTAUTH_URL");
    }
  }
  if (origin && production) {
    const u = new URL(origin);
    if (
      u.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(u.hostname) ||
      u.hostname.endsWith(".localhost")
    )
      errors.push("AUTH_URL");
  }
  const required = [];
  if (auth) required.push("AUTH_SECRET");
  const authMode = v.GOOGLE_AUTH_MODE || "service-account";
  if (database) {
    required.push("GOOGLE_SPREADSHEET_ID");
    if (authMode === "service-account")
      required.push("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY");
  }
  if (storageFeature)
    required.push(
      "SIGNATURE_STORAGE_PROVIDER",
      "PRIVATE_STORAGE_PATH",
      "AUTH_COORDINATION_MODE",
    );
  for (const key of required) if (!v[key]) errors.push(key);
  if (
    v.AUTH_SECRET &&
    (v.AUTH_SECRET.length < 32 ||
      new Set(v.AUTH_SECRET).size < 8 ||
      /change.?me|placeholder|your.?secret/i.test(v.AUTH_SECRET))
  )
    errors.push("AUTH_SECRET");
  if (
    database &&
    authMode === "service-account" &&
    v.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    !z.email().safeParse(v.GOOGLE_SERVICE_ACCOUNT_EMAIL).success
  )
    errors.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (
    v.INITIAL_SUPER_ADMIN_EMAIL &&
    !z.email().safeParse(v.INITIAL_SUPER_ADMIN_EMAIL).success
  )
    errors.push("INITIAL_SUPER_ADMIN_EMAIL");
  if (v.GOOGLE_SPREADSHEET_ID && !/^[\w-]{20,}$/.test(v.GOOGLE_SPREADSHEET_ID))
    errors.push("GOOGLE_SPREADSHEET_ID");
  if (database && authMode === "service-account" && v.GOOGLE_PRIVATE_KEY) {
    try {
      if (
        createPrivateKey(v.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"))
          .asymmetricKeyType !== "rsa"
      )
        errors.push("GOOGLE_PRIVATE_KEY");
    } catch {
      errors.push("GOOGLE_PRIVATE_KEY");
    }
  }
  if (
    database &&
    authMode === "adc" &&
    v.GOOGLE_APPLICATION_CREDENTIALS &&
    !path.isAbsolute(v.GOOGLE_APPLICATION_CREDENTIALS)
  )
    errors.push("GOOGLE_APPLICATION_CREDENTIALS");
  const googleId = v.AUTH_GOOGLE_ID || v.GOOGLE_CLIENT_ID,
    googleSecret = v.AUTH_GOOGLE_SECRET || v.GOOGLE_CLIENT_SECRET;
  if (auth && production && !googleId) errors.push("AUTH_GOOGLE_ID");
  if (auth && production && !googleSecret) errors.push("AUTH_GOOGLE_SECRET");
  if (Boolean(googleId) !== Boolean(googleSecret))
    errors.push("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET");
  if (googleId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(googleId))
    errors.push("AUTH_GOOGLE_ID");
  if (
    googleSecret &&
    (googleSecret.length < 16 ||
      /placeholder|replace|your.?secret/i.test(googleSecret))
  )
    errors.push("AUTH_GOOGLE_SECRET");
  if (
    v.AUTH_GOOGLE_ID &&
    v.GOOGLE_CLIENT_ID &&
    v.AUTH_GOOGLE_ID !== v.GOOGLE_CLIENT_ID
  )
    errors.push("GOOGLE_CLIENT_ID");
  if (
    v.AUTH_GOOGLE_SECRET &&
    v.GOOGLE_CLIENT_SECRET &&
    v.AUTH_GOOGLE_SECRET !== v.GOOGLE_CLIENT_SECRET
  )
    errors.push("GOOGLE_CLIENT_SECRET");
  const storage = path.resolve(v.PRIVATE_STORAGE_PATH || "./private-storage"),
    relative = path.relative(path.resolve(root), storage);
  if (
    storageFeature &&
    production &&
    (!path.isAbsolute(v.PRIVATE_STORAGE_PATH || "") ||
      relative === "" ||
      (!relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative)) ||
      v.STORAGE_PERSISTENCE_CONFIRMED !== "true")
  )
    errors.push("PRIVATE_STORAGE_PATH", "STORAGE_PERSISTENCE_CONFIRMED");
  const signing =
    signingFeature &&
    (production || v.PDF_SIGNING_ENABLED !== undefined
      ? v.PDF_SIGNING_ENABLED === "true"
      : Boolean(v.PDF_SIGNING_P12_PATH || v.PDF_SIGNING_P12_PASSWORD));
  if (signing) {
    for (const key of ["PDF_SIGNING_P12_PATH", "PDF_SIGNING_P12_PASSWORD"])
      if (!v[key]) errors.push(key);
    if (production) {
      if (v.PDF_SIGNING_CERTIFICATE_ENV !== "production")
        errors.push("PDF_SIGNING_CERTIFICATE_ENV");
      if (!path.isAbsolute(v.PDF_SIGNING_P12_PATH || ""))
        errors.push("PDF_SIGNING_P12_PATH");
      if (
        v.OPENSSL_PATH &&
        v.OPENSSL_PATH !== "openssl" &&
        !path.isAbsolute(v.OPENSSL_PATH)
      )
        errors.push("OPENSSL_PATH");
      const rel = path.relative(
        path.resolve(root),
        path.resolve(v.PDF_SIGNING_P12_PATH || "."),
      );
      if (
        !rel.startsWith(".." + path.sep) &&
        rel !== ".." &&
        !path.isAbsolute(rel)
      )
        errors.push("PDF_SIGNING_P12_PATH");
    }
  }
  for (const key of Object.keys(env))
    if (
      key.startsWith("NEXT_PUBLIC_") &&
      /SECRET|PRIVATE_KEY|P12.*PASSWORD/i.test(key)
    )
      errors.push(key);
  if (errors.length) throw new ConfigurationError(errors);
  return {
    ...v,
    APP_ENV: production ? "production" : "development",
    origin,
    production,
    storage,
    signing,
    googleId,
    googleSecret,
    authMode,
    OPENSSL_PATH: v.OPENSSL_PATH || "openssl",
  };
}

/** @param {Record<string,string|undefined>} env */
export const validateAuthEnvironment = (env = process.env) =>
  validateRuntimeEnvironment(env, process.cwd(), "auth");
/** @param {Record<string,string|undefined>} env */
export const validateDatabaseEnvironment = (env = process.env) =>
  validateRuntimeEnvironment(env, process.cwd(), "database");
/** @param {Record<string,string|undefined>} env */
export const validateStorageEnvironment = (
  env = process.env,
  root = process.cwd(),
) => validateRuntimeEnvironment(env, root, "storage");
/** @param {Record<string,string|undefined>} env */
export const validateSigningEnvironment = (env = process.env) =>
  validateRuntimeEnvironment(env, process.cwd(), "signing");
