import { z } from "zod";
import path from "node:path";
import { createPrivateKey } from "node:crypto";
export class ConfigurationError extends Error {
  constructor(fields) {
    super(
      `Konfigurasi runtime tidak valid: ${[...new Set(fields)].join(", ")}`,
    );
    this.name = "ConfigurationError";
  }
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
) {
  const production = env.NODE_ENV === "production";
  const schema = z.object({
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
    SIGNATURE_STORAGE_PROVIDER: z.literal("local").optional(),
    PRIVATE_STORAGE_PATH: value,
    STORAGE_PERSISTENCE_CONFIRMED: z.enum(["true", "false"]).optional(),
    AUTH_COORDINATION_MODE: z.literal("single-host").optional(),
    LEGACY_CREDENTIALS_ENABLED: z.enum(["true", "false"]).optional(),
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
  const result = schema.safeParse(env);
  if (!result.success)
    throw new ConfigurationError(
      result.error.issues.map((i) => String(i.path[0])),
    );
  const v = result.data,
    errors = [];
  if (production && v.APP_ENV !== "production") errors.push("APP_ENV");
  if (!production && v.APP_ENV === "production") errors.push("NODE_ENV");
  let origin;
  try {
    origin = authOrigin(env);
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
  const required = [
    "AUTH_SECRET",
    "GOOGLE_SPREADSHEET_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "SIGNATURE_STORAGE_PROVIDER",
    "PRIVATE_STORAGE_PATH",
    "AUTH_COORDINATION_MODE",
  ];
  if (production) required.push("LEGACY_CREDENTIALS_ENABLED", "COMPANY_NAME");
  for (const key of required) if (!v[key]) errors.push(key);
  if (
    v.AUTH_SECRET &&
    (v.AUTH_SECRET.length < 32 ||
      new Set(v.AUTH_SECRET).size < 8 ||
      /change.?me|placeholder|your.?secret/i.test(v.AUTH_SECRET))
  )
    errors.push("AUTH_SECRET");
  if (
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
  if (v.GOOGLE_PRIVATE_KEY) {
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
  const googleId = v.AUTH_GOOGLE_ID || v.GOOGLE_CLIENT_ID,
    googleSecret = v.AUTH_GOOGLE_SECRET || v.GOOGLE_CLIENT_SECRET;
  if (production && !googleId) errors.push("AUTH_GOOGLE_ID");
  if (production && !googleSecret) errors.push("AUTH_GOOGLE_SECRET");
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
    production &&
    (!path.isAbsolute(v.PRIVATE_STORAGE_PATH || "") ||
      relative === "" ||
      (!relative.startsWith(".." + path.sep) &&
        relative !== ".." &&
        !path.isAbsolute(relative)) ||
      v.STORAGE_PERSISTENCE_CONFIRMED !== "true")
  )
    errors.push("PRIVATE_STORAGE_PATH", "STORAGE_PERSISTENCE_CONFIRMED");
  const signing = production
    ? v.PDF_SIGNING_ENABLED === "true"
    : Boolean(v.PDF_SIGNING_P12_PATH || v.PDF_SIGNING_P12_PASSWORD);
  if (production && v.PDF_SIGNING_ENABLED === undefined)
    errors.push("PDF_SIGNING_ENABLED");
  if (signing) {
    for (const key of [
      "PDF_SIGNING_P12_PATH",
      "PDF_SIGNING_P12_PASSWORD",
      "OPENSSL_PATH",
    ])
      if (!v[key]) errors.push(key);
    if (production) {
      if (v.PDF_SIGNING_CERTIFICATE_ENV !== "production")
        errors.push("PDF_SIGNING_CERTIFICATE_ENV");
      if (!path.isAbsolute(v.PDF_SIGNING_P12_PATH || ""))
        errors.push("PDF_SIGNING_P12_PATH");
      if (!path.isAbsolute(v.OPENSSL_PATH || "")) errors.push("OPENSSL_PATH");
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
  } else if (
    production &&
    (v.PDF_SIGNING_P12_PATH || v.PDF_SIGNING_P12_PASSWORD)
  )
    errors.push("PDF_SIGNING_P12_PATH", "PDF_SIGNING_P12_PASSWORD");
  for (const key of Object.keys(env))
    if (
      key.startsWith("NEXT_PUBLIC_") &&
      /SECRET|PRIVATE_KEY|P12.*PASSWORD/i.test(key)
    )
      errors.push(key);
  if (errors.length) throw new ConfigurationError(errors);
  return { ...v, origin, production, storage, signing, googleId, googleSecret };
}
