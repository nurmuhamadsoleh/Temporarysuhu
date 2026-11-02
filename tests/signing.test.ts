import { describe, it, expect, vi } from "vitest";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { existsSync } from "node:fs";
import { validateP12, verifySignedPdf } from "@/lib/server/reports";
import { generateControlPdf } from "@/lib/server/control-pdf";
import { fixtureReport } from "./control-fixtures";
const openssl =
  process.env.OPENSSL_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Git/usr/bin/openssl.exe"
    : "/usr/bin/openssl");
describe("Certificate signing verification", () => {
  it.skipIf(!existsSync(openssl))(
    "signs and cryptographically verifies a test certificate, rejects tampered bytes",
    async () => {
      process.env.OPENSSL_PATH = openssl;
      const pair = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = pair.publicKey;
      cert.serialNumber = "01";
      cert.validity.notBefore = new Date(Date.now() - 86400000);
      cert.validity.notAfter = new Date(Date.now() + 86400000);
      cert.setSubject([{ name: "commonName", value: "TEST ONLY" }]);
      cert.setIssuer(cert.subject.attributes);
      cert.sign(pair.privateKey, forge.md.sha256.create());
      const p12 = Buffer.from(
        forge.asn1
          .toDer(
            forge.pkcs12.toPkcs12Asn1(
              pair.privateKey,
              [cert],
              "test-password",
              { algorithm: "3des" },
            ),
          )
          .getBytes(),
        "binary",
      );
      expect(() => validateP12(p12, "test-password")).not.toThrow();
      expect(() => validateP12(p12, "wrong-password")).toThrow();
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      page.drawText("Certificate signing integration test");
      pdflibAddPlaceholder({
        pdfDoc: doc,
        reason: "Test",
        contactInfo: "",
        name: "TEST ONLY",
        location: "Test",
      });
      const unsigned = Buffer.from(await doc.save({ useObjectStreams: false }));
      const signed = await signpdf.sign(
        unsigned,
        new P12Signer(p12, { passphrase: "test-password" }),
      );
      await expect(verifySignedPdf(signed)).resolves.toBeUndefined();
      const control = fixtureReport();
      const unsignedControl = await generateControlPdf(
        control,
        { name: "TEST ONLY", at: control.createdAt },
        true,
      );
      const signedControl = await signpdf.sign(
        unsignedControl,
        new P12Signer(p12, { passphrase: "test-password" }),
      );
      await expect(verifySignedPdf(signedControl)).resolves.toBeUndefined();
      const tampered = Buffer.from(signed);
      tampered[10] = tampered[10] ^ 1;
      await expect(verifySignedPdf(tampered)).rejects.toThrow("Verifikasi");
      vi.stubEnv("NODE_ENV", "production");
      try {
        expect(() => validateP12(p12, "test-password")).toThrow();
      } finally {
        vi.unstubAllEnvs();
      }
    },
    30000,
  );
});
