import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { fixtureRecord, fixtureReport } from "./control-fixtures";
import { makeControlPages } from "@/lib/temperature-report/model";
import { buildControlScenes } from "@/lib/temperature-report/scene";
import {
  monitoringPeriod,
  formatVerificationAt,
} from "@/lib/temperature-report/presentation";
const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  log: vi.fn(),
  file: vi.fn(),
}));
vi.mock("@/lib/server/user-service", () => ({ userTable: mocks.users }));
vi.mock("@/lib/server/safe-log", () => ({ safeLog: mocks.log }));
vi.mock("@/lib/server/storage", () => ({ getFile: mocks.file }));
import { buildTemperatureReportData } from "@/lib/server/report-data";
import { generateTemperatureControlPdf } from "@/lib/server/control-pdf";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REPORT_SUPERVISOR_NAME", "");
  mocks.users.mockResolvedValue({
    users: [{ id: "test-operator", name: "Nur Muhamad Soleh" }],
  });
});
describe("Display-only report identities and monitoring dates", () => {
  it("resolves each historical owner, never the viewer, without changing source data", async () => {
    const source = fixtureReport("chiller", 1, [
      fixtureRecord("chiller", { officer: "ns" }),
      fixtureRecord("chiller", { createdBy: "other", officer: "historical" }),
    ]);
    const before = JSON.stringify(source);
    const report = await buildTemperatureReportData(source, [
      { id: "test-operator", name: "Nur Muhamad Soleh" },
      { id: "other", name: "Petugas Kedua" },
      { id: "viewer", name: "Super Admin" },
    ]);
    expect(report.readings.map((r) => r.operatorName).sort()).toEqual([
      "Nur Muhamad Soleh",
      "Petugas Kedua",
    ]);
    expect(report.presentation?.supervisorName).toBe("Chef Bulloh");
    expect(JSON.stringify(source)).toBe(before);
    expect(report.sourceHash).toBe(source.sourceHash);
    expect(report.pages).toBe(source.pages);
    expect(report.readings.every((r) => r.temperatureCelsius === 1.8)).toBe(
      true,
    );
  });
  it("uses the historical name when unavailable and logs a hashed reference", async () => {
    const report = await buildTemperatureReportData(fixtureReport(), []);
    expect(report.readings[0].operatorName).toBe("Petugas Data Uji");
    expect(mocks.log).toHaveBeenCalledWith(
      "report_identity_fallback",
      "APP_USER_NAME_MISSING",
      expect.stringMatching(/^[a-f0-9]{12}$/),
    );
  });
  it("fails accurately if APP_USERS cannot be read", async () => {
    mocks.users.mockRejectedValue(new Error("Sheets unavailable"));
    await expect(buildTemperatureReportData(fixtureReport())).rejects.toThrow(
      "Sheets unavailable",
    );
  });
  it("reads the supervisor from the single server configuration", async () => {
    vi.stubEnv("REPORT_SUPERVISOR_NAME", "Supervisor Perusahaan");
    expect(
      (await buildTemperatureReportData(fixtureReport())).presentation
        ?.supervisorName,
    ).toBe("Supervisor Perusahaan");
  });
  it("uses measurement dates for daily, weekly, monthly reports, independently of generation time", () => {
    const report = fixtureReport();
    report.filter.from = "2026-11-01";
    report.filter.to = "2026-11-01";
    expect(monitoringPeriod(report)).toBe("Tanggal: 01/11/2026");
    report.filter.to = "2026-11-07";
    expect(monitoringPeriod(report)).toBe("Periode: 01/11/2026 - 07/11/2026");
    delete report.filter.from;
    delete report.filter.to;
    expect(monitoringPeriod(report)).toBe("Periode: November 2026");
    expect(formatVerificationAt("2026-11-01T18:30:00Z")).toBe(
      "02/11/2026 01:30 WIB",
    );
  });
});
const pdfPython = process.env.PDF_TEST_PYTHON || "python";
let hasExtractor = true;
try {
  execFileSync(pdfPython, ["-c", "import pypdf"], { stdio: "pipe" });
} catch {
  hasExtractor = false;
}
function extractPdf(pdf: Buffer) {
  return execFileSync(
    pdfPython,
    [
      "-c",
      "import sys,io; from pypdf import PdfReader; sys.stdout.buffer.write('\\n'.join(p.extract_text() or '' for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages).encode('utf-8'))",
    ],
    { input: pdf },
  ).toString();
}
describe.skipIf(!hasExtractor)(
  "Extracted PDF content",
  { timeout: 30000 },
  () => {
    it.each(["chiller", "freezer"] as const)(
      "keeps %s preview/export bytes, names, decimals and neutral status consistent",
      async (kind) => {
        const source = fixtureReport(kind, 1, [
          fixtureRecord(kind, { officer: "ns" }),
        ]);
        source.sop = null;
        source.readings.forEach((r) => (r.status = "BELUM DIKONFIGURASI"));
        const report = await buildTemperatureReportData(source);
        const pdf = await generateTemperatureControlPdf(report);
        expect(await generateTemperatureControlPdf(report)).toEqual(pdf);
        const text = extractPdf(pdf);
        for (const banned of [
          "Report ID",
          "Record ID",
          "User ID",
          "Jam tambahan memakai waktu aktual",
          "Lampiran - seluruh pembacaan",
          "BELUM DIKONFIGURASI",
          "Status: Normal",
        ])
          expect(text).not.toContain(banned);
        expect(text).not.toMatch(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
        );
        expect(text).not.toMatch(/\bns\b/);
        expect(text).toContain("Nama Supervisor: Chef Bulloh");
        expect(text).toContain("Nur Muhamad Soleh");
        expect(text).toContain(kind === "chiller" ? "1,8" : "-18,5");
        expect(text).toContain("Waktu: 07:00 WIB");
        expect(text).toContain("BELUM DIVERIFIKASI");
        expect(text).not.toContain("Tanggal verifikasi:");
        expect(text).toContain("Periode: 09/11/2026 - 16/11/2026");
      },
    );
    it("prints the actual verification timestamp separately from the monitoring period", async () => {
      const report = await buildTemperatureReportData(fixtureReport());
      const pdf = await generateTemperatureControlPdf(report, {
        name: "Supervisor Pengesah",
        at: "2026-11-17T18:30:00Z",
      });
      const text = extractPdf(pdf);
      expect(text).toContain("Nama Supervisor: Chef Bulloh");
      expect(text).toContain("Diverifikasi oleh: Supervisor Pengesah");
      expect(text).toContain("Tanggal verifikasi: 18/11/2026 01:30 WIB");
      expect(text).toContain("Periode: 09/11/2026 - 16/11/2026");
    });
    it.each(["day", "month"])(
      "prints the selected %s period in the PDF",
      async (period) => {
        const report = await buildTemperatureReportData(fixtureReport());
        if (period === "day") {
          report.filter.from = "2026-11-10";
          report.filter.to = "2026-11-10";
        } else {
          delete report.filter.from;
          delete report.filter.to;
        }
        report.pages = makeControlPages(
          report.readings,
          report.filter,
          report.settings,
        );
        const text = extractPdf(await generateTemperatureControlPdf(report));
        expect(text).toContain(
          period === "day" ? "Tanggal: 10/11/2026" : "Periode: November 2026",
        );
      },
    );
    it("keeps empty reports free from blank detail pages", async () => {
      const report = await buildTemperatureReportData(
        fixtureReport("chiller", 1, []),
      );
      const pdf = await PDFDocument.load(
        await generateTemperatureControlPdf(report),
      );
      expect(pdf.getPageCount()).toBe(report.pages.length);
    });
    it("preserves point coordinates and real signature references", async () => {
      const source = fixtureReport("freezer", 4, [
        fixtureRecord("freezer", { signatureId: "real-signature" }),
      ]);
      const report = await buildTemperatureReportData(source);
      expect(report.pages).toEqual(source.pages);
      const commands = buildControlScenes(report).flatMap((p) => p.commands);
      expect(
        commands.some(
          (c) =>
            c.kind === "image" && c.signatureReference === "real-signature",
        ),
      ).toBe(true);
      expect(
        commands.filter((c) => c.kind === "circle" && c.readingIds?.length),
      ).toHaveLength(1);
    });
    it("prints action workflow labels and the manually recorded performer without claiming verification", async () => {
      const report = await buildTemperatureReportData(fixtureReport());
      report.corrections = ["PENDING", "PERBAIKAN", "SELESAI"].map(
        (actionStatus, i) => ({
          id: crypto.randomUUID(),
          recordId: report.readings[0].recordId,
          deviceType: "chiller",
          deviceNumber: 1,
          date: "2026-11-10",
          time: "07:00",
          description: "DATA UJI tindakan " + (i + 1),
          performedBy: "test-operator",
          performedByName: "Teknisi Lapangan",
          performerIsManual: true,
          actionStatus: actionStatus as "PENDING" | "PERBAIKAN" | "SELESAI",
          verificationStatus: "PENDING",
          verifiedBy: "",
          verifiedByName: "",
          verifiedAt: "",
          createdAt: report.createdAt,
          updatedAt: report.createdAt,
        }),
      );
      const projected = await buildTemperatureReportData(report);
      expect(
        projected.corrections.every(
          (a) => a.performedByName === "Teknisi Lapangan",
        ),
      ).toBe(true);
      const text = extractPdf(await generateTemperatureControlPdf(projected));
      for (const label of [
        "Status Tindakan",
        "Pending",
        "Perbaikan",
        "Selesai",
        "Teknisi Lapangan",
        "BELUM DIVERIFIKASI",
      ])
        expect(text).toContain(label);
      expect(text).not.toContain("Tanggal verifikasi:");
    });
    it("keeps all ten actions and long multiline text in bordered continuation tables", async () => {
      const report = await buildTemperatureReportData(fixtureReport());
      report.corrections = Array.from({ length: 10 }, (_, i) => ({
        id: crypto.randomUUID(),
        recordId: report.readings[0].recordId,
        deviceType: "chiller",
        deviceNumber: 1,
        date: "2026-11-10",
        time: "07:00",
        description:
          "TINDAKAN-" +
          String(i + 1).padStart(2, "0") +
          "\n" +
          (i === 9
            ? Array.from(
                { length: 60 },
                (_, j) => "Rincian pemeriksaan " + (j + 1),
              ).join("\n")
            : "DATA UJI catatan lengkap") +
          "\nAKHIR-" +
          (i + 1),
        performedBy: "operator",
        performedByName: "Pelaksana Data Uji",
        performerIsManual: true,
        actionStatus: "PERBAIKAN",
        verificationStatus: "PENDING",
        verifiedBy: "",
        verifiedByName: "",
        verifiedAt: "",
        createdAt: report.createdAt,
        updatedAt: report.createdAt,
      }));
      const scenes = buildControlScenes(report).filter((p) =>
        p.label.startsWith("Koreksi dan Tindakan Korektif"),
      );
      expect(scenes.length).toBeGreaterThan(1);
      for (const page of scenes) {
        expect(
          page.commands.some(
            (c) => c.kind === "text" && c.text === "Pemeriksa",
          ),
        ).toBe(true);
        expect(
          page.commands
            .filter((c) => c.kind === "text")
            .every((c) => c.y + c.size <= page.height),
        ).toBe(true);
      }
      const text = extractPdf(await generateTemperatureControlPdf(report));
      for (let i = 1; i <= 10; i++) {
        expect(text).toContain("TINDAKAN-" + String(i).padStart(2, "0"));
        expect(text).toContain("AKHIR-" + i);
      }
      expect(text).toContain("Rincian pemeriksaan 60");
    });
    it.each(["chiller", "freezer"] as const)(
      "prints full %s operator identities, never P-codes, in generated preview/download PDF",
      async (kind) => {
        mocks.users.mockResolvedValue({
          users: [
            { id: "first", name: "Nur Muhamad Soleh" },
            { id: "second", name: "Petugas Pengukuran Lain" },
            { id: "viewer", name: "Admin Pembaca" },
          ],
        });
        const source = fixtureReport(kind, 1, [
          fixtureRecord(kind, {
            time: "07:00",
            createdBy: "first",
            officer: "ns",
          }),
          fixtureRecord(kind, {
            time: "11:00",
            createdBy: "second",
            officer: "pl",
          }),
          fixtureRecord(kind, {
            time: "15:00",
            createdBy: "first",
            officer: "ns",
          }),
        ]);
        source.settings.operatorStyle = "initials";
        const report = await buildTemperatureReportData(source),
          preview = await generateTemperatureControlPdf(report),
          download = await generateTemperatureControlPdf(report);
        expect(preview).toEqual(download);
        const text = extractPdf(preview);
        expect(text).toContain("Nur Muhamad Soleh");
        expect(text).toContain("Petugas Pengukuran Lain");
        expect(text).not.toMatch(/\bP\d+\b|\bns\b|\bpl\b|@/);
        expect(text).not.toContain("Admin Pembaca");
      },
    );
  },
);
