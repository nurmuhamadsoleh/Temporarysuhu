import "server-only";
import forge from "node-forge";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "./errors";
import {
  ConfigurationError,
  validateSigningEnvironment,
} from "./runtime-config.mjs";
import { startupDiagnostic } from "./startup-diagnostics.mjs";
import { FeatureUnavailable } from "./dependency-failure";

export function validateP12(data: Buffer, password: string) {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(data.toString("binary")),
      password,
    );
    const keys =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] || [];
    const certs =
      p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ] || [];
    const key = keys[0]?.key as forge.pki.rsa.PrivateKey | undefined;
    const cert = certs
      .map((b) => b.cert)
      .find(
        (c) =>
          c && key && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n),
      );
    if (
      !key ||
      !cert ||
      (process.env.NODE_ENV === "production" && cert.isIssuer(cert)) ||
      cert.validity.notBefore > new Date() ||
      cert.validity.notAfter < new Date()
    )
      throw new Error();
    return cert;
  } catch {
    throw new AppError(
      422,
      "Sertifikat P12 invalid, belum berlaku, expired, atau password salah",
    );
  }
}

/** Called only by the signing feature or authenticated/CLI diagnostics, never startup or login. */
export async function loadSigningCertificate() {
  let config;
  try {
    config = validateSigningEnvironment();
  } catch (error) {
    const fields = error instanceof ConfigurationError ? error.fields : [];
    startupDiagnostic(
      "pdf_signing",
      "unavailable",
      "SIGNING_CONFIG_INVALID",
      "WARNING",
      fields,
    );
    throw new FeatureUnavailable(
      "SIGNING_CONFIG_INVALID",
      "Konfigurasi signing bersertifikat belum tersedia.",
      fields,
    );
  }
  if (!config.signing)
    throw new FeatureUnavailable(
      "SIGNING_DISABLED",
      "Mode B tidak diaktifkan pada server.",
    );
  let data: Buffer;
  try {
    data = await readFile(config.PDF_SIGNING_P12_PATH!);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const errorCode =
      code === "ENOENT"
        ? "CERTIFICATE_ENOENT"
        : code === "EACCES"
          ? "CERTIFICATE_EACCES"
          : "SIGNING_UNAVAILABLE";
    startupDiagnostic("pdf_signing", "unavailable", errorCode, "WARNING");
    throw new FeatureUnavailable(
      errorCode,
      "File sertifikat belum tersedia atau tidak dapat dibaca.",
    );
  }
  try {
    validateP12(data, config.PDF_SIGNING_P12_PASSWORD!);
  } catch {
    startupDiagnostic(
      "pdf_signing",
      "unavailable",
      "CERTIFICATE_INVALID",
      "WARNING",
    );
    throw new FeatureUnavailable(
      "CERTIFICATE_INVALID",
      "Sertifikat belum valid untuk signing production.",
    );
  }
  try {
    await promisify(execFile)(config.OPENSSL_PATH, ["version"], {
      timeout: 10000,
      windowsHide: true,
    });
  } catch (error) {
    const errorCode =
      (error as { code?: string }).code === "ENOENT"
        ? "OPENSSL_ENOENT"
        : "OPENSSL_UNAVAILABLE";
    startupDiagnostic("pdf_signing", "unavailable", errorCode, "WARNING");
    throw new FeatureUnavailable(
      errorCode,
      "Executable OpenSSL belum tersedia untuk signing.",
    );
  }
  return {
    data,
    password: config.PDF_SIGNING_P12_PASSWORD!,
    openssl: config.OPENSSL_PATH,
  };
}
export async function signingAvailability() {
  try {
    await loadSigningCertificate();
    return { available: true, status: "ready", errorCode: "SIGNING_READY" };
  } catch (error) {
    const code =
      error instanceof FeatureUnavailable
        ? error.errorCode
        : "SIGNING_UNAVAILABLE";
    return {
      available: false,
      status: code === "SIGNING_DISABLED" ? "disabled" : "unavailable",
      errorCode: code,
    };
  }
}
