import { measurementRefs } from "@/lib/devices";
import "server-only";
import {
  getControlData,
  checkControlFresh,
  verificationRow,
} from "./control-records";
import { generateTemperatureControlPdf } from "./control-pdf";
import { buildTemperatureReportData } from "./report-data";
import {
  reportDates,
  type ControlFilter,
  type TemperatureReport,
} from "@/lib/temperature-report/model";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { loadSigningCertificate, signingAvailability } from "./signing-service";
export { validateP12 } from "./signing-service";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  allRecords,
  rows,
  ensureSheetHeaders,
  batch,
  append,
  replace,
  audit,
  getSop,
} from "./sheets";
import { putFile, getFile } from "./storage";
import { AppError } from "./errors";
import {
  filterRecords,
  displayDate,
  type Measurement,
  type Actor,
  type Sop,
} from "@/lib/domain";
export type Snapshot = {
  control?: TemperatureReport;
  id: string;
  createdAt: string;
  createdBy: string;
  officer: string;
  company: string;
  records: Measurement[];
  sop: Sop;
  from: string;
  to: string;
  revisionOf: string;
};
export async function createControlReport(
  filter: ControlFilter,
  actor: Actor,
  revisionOf = "",
  id = crypto.randomUUID(),
) {
  const ids = await ensureSheetHeaders();
  const previous = (await rows("REPORTS")).find((r) => r[0] === id);
  if (previous) {
    const saved = (await report(id)).snapshot;
    if (
      saved.createdBy !== actor.id ||
      JSON.stringify(saved.control?.filter) !== JSON.stringify(filter) ||
      saved.revisionOf !== revisionOf
    )
      throw new AppError(409, "Request ID telah digunakan");
    return saved;
  }
  if (revisionOf) {
    const original = (await report(revisionOf)).snapshot;
    if (
      !original.control ||
      original.control.device.type !== filter.kind ||
      original.control.device.number !== filter.deviceNumber
    )
      throw new AppError(409, "Revisi harus mengacu ke perangkat yang sama");
  }
  const { report: control, records, sop } = await getControlData(filter, id),
    dates = reportDates(filter);
  const snapshot: Snapshot = {
    id,
    createdAt: control.createdAt,
    createdBy: actor.id,
    officer: actor.name,
    company: control.company,
    records,
    sop,
    from: dates[0],
    to: dates.at(-1)!,
    revisionOf,
    control,
  };
  await putFile(`${id}.json`, JSON.stringify(snapshot));
  await batch([
    append(ids.REPORTS, [
      id,
      snapshot.createdAt,
      actor.id,
      `${id}.json`,
      "DRAFT",
      "",
      "",
      "",
      "",
      revisionOf,
    ]),
    audit(ids, actor, "CREATE_CONTROL_REPORT", id, null, {
      filter,
      sourceHash: control.sourceHash,
      revisionOf,
    }),
  ]);
  return snapshot;
}
export async function createReport(
  p: URLSearchParams,
  actor: Actor,
  revisionOf = "",
) {
  if (revisionOf) await report(revisionOf);
  const records = filterRecords(await allRecords(), p);
  if (!records.length) throw new AppError(400, "Tidak ada data untuk laporan");
  if (records.length > 2000)
    throw new AppError(
      400,
      "Persempit periode laporan (maksimum 2000 pengukuran)",
    );
  const id = crypto.randomUUID(),
    ids = await ensureSheetHeaders();
  const snapshot: Snapshot = {
    id,
    createdAt: new Date().toISOString(),
    createdBy: actor.id,
    officer: actor.name,
    company: process.env.COMPANY_NAME || "Temperature Monitoring System",
    records,
    sop: await getSop(),
    from: p.get("from") || records.at(-1)!.date,
    to: p.get("to") || records[0].date,
    revisionOf,
  };
  await putFile(`${id}.json`, JSON.stringify(snapshot));
  await batch([
    append(ids.REPORTS, [
      id,
      snapshot.createdAt,
      actor.id,
      `${id}.json`,
      "DRAFT",
      "",
      "",
      "",
      "",
      revisionOf,
    ]),
    audit(ids, actor, "CREATE_REPORT", id, null, {
      recordIds: records.map((r) => r.id),
      revisionOf,
    }),
  ]);
  return snapshot;
}
export async function report(id: string) {
  const data = await rows("REPORTS"),
    index = data.findIndex((r) => r[0] === id);
  if (index < 1) throw new AppError(404, "Laporan tidak ditemukan");
  const snapshot = JSON.parse(
    (await getFile(`${id}.json`)).toString(),
  ) as Snapshot;
  return { data, index, row: data[index], snapshot };
}
export async function approveReport(
  id: string,
  actor: Actor,
  signatureId: string,
) {
  const { row, index, snapshot } = await report(id);
  if (row[4] !== "DRAFT") throw new AppError(409, "Laporan sudah diproses");
  const current = await allRecords();
  if (
    snapshot.control &&
    !(await checkControlFresh(snapshot.control, actor)).fresh
  )
    throw new AppError(
      409,
      "Sumber laporan berubah. Buat revisi dan verifikasi kembali.",
    );
  if (
    snapshot.records.some(
      (r) => !current.some((c) => c.id === r.id && c.updatedAt === r.updatedAt),
    )
  )
    throw new AppError(409, "Data telah berubah. Buat revisi laporan baru.");
  const ids = await ensureSheetHeaders(),
    before = [...row];
  const signatures = await rows("SIGNATURE_METADATA");
  const signature = signatures.find(
    (r) => r[0] === signatureId && r[1] === actor.id && !r[2],
  );
  if (!signature)
    throw new AppError(400, "Tanda tangan pemeriksa tidak tersedia");
  signature[2] = id;
  row[4] = "APPROVED";
  row[5] = actor.name;
  row[6] = new Date().toISOString();
  row[10] = signatureId;
  const controlVerificationRequests = snapshot.control
    ? [
        append(
          ids.TEMPERATURE_REPORT_VERIFICATIONS,
          verificationRow(snapshot.control, actor, signatureId, String(row[6])),
        ),
      ]
    : [];
  await batch([
    replace(ids.REPORTS, index, row),
    replace(ids.SIGNATURE_METADATA, signatures.indexOf(signature), signature),
    audit(ids, actor, "APPROVE_REPORT", id, before, row),
    ...controlVerificationRequests,
  ]);
  return row;
}
const safeText = (v: string) => v.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
export async function generatePdf(
  snapshot: Snapshot,
  approval?: {
    name: string;
    at: string;
    signatureId?: string;
    status?: string;
  },
  certificate = false,
) {
  if (snapshot.control)
    return generateTemperatureControlPdf(
      await buildTemperatureReportData(snapshot.control),
      approval,
      certificate,
    );
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([842, 595]),
    y = 550;
  const text = (s: string, x = 38, size = 10, strong = false) =>
    page.drawText(safeText(s), {
      x,
      y,
      size,
      font: strong ? bold : font,
      color: rgb(0.14, 0.2, 0.3),
    });
  const newPage = () => {
    page = doc.addPage([842, 595]);
    y = 550;
  };
  text(snapshot.company, 38, 12, true);
  y -= 28;
  text("TEMPERATURE MONITORING REPORT", 38, 20, true);
  y -= 21;
  text("Monitoring Suhu Chiller & Freezer");
  y -= 19;
  text(
    `Periode ${displayDate(snapshot.from)} - ${displayDate(snapshot.to)} | Dicetak ${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.createdAt))} WIB`,
  );
  y -= 18;
  text(`Disusun: ${snapshot.officer}`);
  y -= 25;
  const values = snapshot.records
      .flatMap((r) => r.values)
      .filter((v): v is number => v !== null),
    outside = snapshot.records.reduce((n, r) => {
      const s = snapshot.sop[r.kind];
      return (
        n +
        (s
          ? r.values.filter((v) => v !== null && (v < s.min || v > s.max))
              .length
          : 0)
      );
    }, 0);
  text(
    values.length
      ? `Pembacaan: ${values.length} | Rata-rata: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} C | Min: ${Math.min(...values).toFixed(1)} C | Max: ${Math.max(...values).toFixed(1)} C | Di luar SOP: ${outside}`
      : "Belum ada suhu terukur pada periode ini",
    38,
    10,
    true,
  );
  y -= 19;
  text(
    `SOP Chiller: ${snapshot.sop.chiller ? JSON.stringify(snapshot.sop.chiller) : "BELUM DIKONFIGURASI"} | Freezer: ${snapshot.sop.freezer ? JSON.stringify(snapshot.sop.freezer) : "BELUM DIKONFIGURASI"}`,
  );
  y -= 25;
  for (const r of snapshot.records) {
    if (y < 100) newPage();
    text(
      `${displayDate(r.date)} ${r.time} WIB | ${r.kind.toUpperCase()} | ${r.officer}`,
      38,
      10,
      true,
    );
    y -= 17;
    const parts = r.values.map(
      (v, i) =>
        measurementRefs(r)[i].number +
        ": " +
        (v === null ? "Belum diisi" : v.toFixed(1).replace(".", ",") + " C"),
    );
    parts.push("Status: " + r.status);
    let readingLine = "";
    for (const part of parts) {
      const candidate = readingLine ? readingLine + "     " + part : part;
      if (
        readingLine &&
        font.widthOfTextAtSize(safeText(candidate), 10) > 760
      ) {
        if (y < 90) newPage();
        text(readingLine);
        y -= 17;
        readingLine = part;
      } else readingLine = candidate;
    }
    if (readingLine) {
      if (y < 90) newPage();
      text(readingLine);
      y -= 17;
    }
    for (let i = 0; i < r.notes.length; i += 115) {
      if (y < 90) newPage();
      text(r.notes.slice(i, i + 115));
      y -= 14;
    }
    try {
      const png = await doc.embedPng(await getFile(`${r.signatureId}.png`));
      page.drawImage(png, { x: 660, y: y - 35, width: 100, height: 35 });
    } catch {
      throw new AppError(409, "File tanda tangan laporan tidak tersedia");
    }
    text(`Tanda tangan elektronik visual | Petugas ${r.officer}`, 38, 8);
    y -= 50;
  }
  if (y < 140) newPage();
  y -= 10;
  text(
    `Ringkasan: ${snapshot.records.length} pengukuran; ${outside} pembacaan di luar SOP yang dikonfigurasi.`,
  );
  y -= 22;
  text(
    approval
      ? `Pemeriksa: ${approval.name} | Disetujui: ${approval.at}`
      : "Pemeriksa: Belum disetujui",
  );
  if (approval?.signatureId) {
    const png = await doc.embedPng(
      await getFile(`${approval.signatureId}.png`),
    );
    page.drawImage(png, { x: 660, y: y - 35, width: 100, height: 35 });
    y -= 40;
  }
  y -= 18;
  text(
    certificate
      ? "Dokumen ditandatangani secara kriptografis. Periksa kepercayaan sertifikat pada PDF reader."
      : "Mode A: Tanda tangan elektronik visual. Dokumen ini belum ditandatangani dengan sertifikat.",
    38,
    9,
  );
  doc.setTitle("Temperature Monitoring Report");
  doc.setAuthor(snapshot.officer);
  if (certificate)
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: "Approval laporan monitoring suhu",
      contactInfo: "",
      name: approval!.name,
      location: "Asia/Jakarta",
      signatureLength: 20000,
    });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
export async function certificateConfigured() {
  return (await signingAvailability()).available;
}
export async function verifySignedPdf(pdf: Buffer) {
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    pdf.toString("latin1"),
  );
  if (!match) throw new AppError(422, "ByteRange PDF tidak ditemukan");
  const [a, b, c, d] = match.slice(1).map(Number);
  if (a !== 0 || c + d !== pdf.length || b >= c)
    throw new AppError(422, "ByteRange PDF tidak valid");
  const gap = pdf.subarray(b, c).toString("latin1").trim();
  if (!/^<[0-9a-fA-F]+>$/.test(gap))
    throw new AppError(422, "Signature PDF invalid");
  const cms = Buffer.from(gap.slice(1, -1), "hex");
  const tmp = await mkdtemp(path.join(tmpdir(), "tms-verify-"));
  try {
    await writeFile(path.join(tmp, "signature.der"), cms);
    await writeFile(
      path.join(tmp, "content.bin"),
      Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]),
    );
    await promisify(execFile)(
      process.env.OPENSSL_PATH || "openssl",
      [
        "cms",
        "-verify",
        "-binary",
        "-inform",
        "DER",
        "-in",
        path.join(tmp, "signature.der"),
        "-content",
        path.join(tmp, "content.bin"),
        "-noverify",
        "-out",
        path.join(tmp, "verified.bin"),
      ],
      { timeout: 20000, windowsHide: true },
    );
  } catch {
    throw new AppError(
      422,
      "Verifikasi kriptografi gagal. Pastikan OpenSSL tersedia di server dan sertifikat valid.",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
export async function signReport(id: string, actor: Actor) {
  const certificate = await loadSigningCertificate();
  const { snapshot, row, index } = await report(id);
  if (row[4] !== "APPROVED")
    throw new AppError(409, "Laporan harus disetujui dan belum ditandatangani");
  if (snapshot.control) {
    const state = await checkControlFresh(snapshot.control, actor);
    if (!state.fresh || state.verification?.status !== "VERIFIED")
      throw new AppError(409, "Verifikasi tidak berlaku. Buat revisi laporan.");
  }
  const pdf = await generatePdf(
    snapshot,
    {
      name: String(row[5]),
      at: String(row[6]),
      signatureId: String(row[10] || ""),
    },
    true,
  );
  const signed = await signpdf.sign(
    pdf,
    new P12Signer(certificate.data, { passphrase: certificate.password }),
  );
  await verifySignedPdf(signed);
  const file = `${id}.signed.pdf`;
  await putFile(file, signed);
  const ids = await ensureSheetHeaders();
  row[4] = "SIGNED";
  row[7] = file;
  row[8] = createHash("sha256").update(signed).digest("hex");
  await batch([
    replace(ids.REPORTS, index, row),
    audit(ids, actor, "SIGN_REPORT", id, null, {
      sha256: row[8],
      signer: actor.id,
    }),
  ]);
  return { id, sha256: row[8] };
}
