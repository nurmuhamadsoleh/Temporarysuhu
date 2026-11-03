import { loadEnvConfig } from "@next/env";
import { validateStartup } from "../src/lib/server/startup";
import { checkSheetsAccess } from "../src/lib/server/readiness";
import { validateRuntimeEnvironment } from "../src/lib/server/runtime-config.mjs";
import { featureReadiness } from "../src/lib/server/feature-readiness";
async function main() {
  const sheetsOnly = process.argv.includes("--sheets-only");
  if (!sheetsOnly) Object.assign(process.env, { NODE_ENV: "production" });
  loadEnvConfig(process.cwd(), sheetsOnly, {
    info() {},
    error() {
      console.error("ENV_LOAD_FAILED");
    },
  });
  if (sheetsOnly) {
    await checkSheetsAccess();
    console.log("SHEETS_READ_AND_HEADERS_OK (tidak membuktikan izin write)");
    return;
  }
  if (process.argv.includes("--config-only")) {
    validateRuntimeEnvironment();
    console.log("PRODUCTION_ENV_OK");
    return;
  }
  await validateStartup();
  const readiness = await featureReadiness();
  console.log(JSON.stringify(readiness));
  if (readiness.status !== "ready")
    throw new Error("DEPENDENCY_READINESS_FAILED");
  if (process.argv.includes("--signing")) {
    const { loadSigningCertificate } =
      await import("../src/lib/server/signing-service");
    const certificate = await loadSigningCertificate();
    const [
      { PDFDocument },
      { pdflibAddPlaceholder },
      { default: signpdf },
      { P12Signer },
      { verifySignedPdf },
    ] = await Promise.all([
      import("pdf-lib"),
      import("@signpdf/placeholder-pdf-lib"),
      import("@signpdf/signpdf"),
      import("@signpdf/signer-p12"),
      import("../src/lib/server/reports"),
    ]);
    const pdf = await PDFDocument.create();
    pdf
      .addPage()
      .drawText(
        "TempControl production signing verification - not an operational report",
      );
    pdflibAddPlaceholder({
      pdfDoc: pdf,
      reason: "Production configuration verification",
      name: "TempControl preflight",
      contactInfo: "",
      location: "Asia/Jakarta",
    });
    const signed = await signpdf.sign(
      Buffer.from(await pdf.save({ useObjectStreams: false })),
      new P12Signer(certificate.data, {
        passphrase: certificate.password,
      }),
    );
    await verifySignedPdf(signed);
    console.log(
      "SIGNING_CRYPTOGRAPHY_OK (sertifikat tetap perlu trust/revocation review organisasi)",
    );
  }
  console.log("PRODUCTION_PREFLIGHT_OK");
}
main().catch((error) => {
  console.error(
    error instanceof Error && error.name === "ConfigurationError"
      ? error.message
      : `PREFLIGHT_FAILED (${error instanceof Error ? error.name : "Unknown"}): periksa konfigurasi server, header/akses Sheets, storage, sertifikat/OpenSSL.`,
  );
  process.exitCode = 1;
});
