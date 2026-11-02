import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import {
  buildControlScenes,
  type ControlApproval,
} from "@/lib/temperature-report/scene";
import type { TemperatureReport } from "@/lib/temperature-report/model";
import { getFile } from "./storage";
import { AppError } from "./errors";
const color = (hex = "#657180") =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
export async function generateControlPdf(
  report: TemperatureReport,
  approval?: ControlApproval,
  certificate = false,
) {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const scene of buildControlScenes(report, approval)) {
    const page = doc.addPage([scene.width, scene.height]);
    for (const c of scene.commands) {
      if (c.kind === "text")
        page.drawText(safe(c.text), {
          x:
            c.align === "center"
              ? c.x -
                (c.bold ? bold : font).widthOfTextAtSize(safe(c.text), c.size) /
                  2
              : c.x,
          y: scene.height - c.y - c.size,
          size: c.size,
          font: c.bold ? bold : font,
          color: color(c.color || "#172033"),
        });
      else if (c.kind === "line")
        page.drawLine({
          start: { x: c.x, y: scene.height - c.y },
          end: { x: c.x2, y: scene.height - c.y2 },
          thickness: c.weight || 0.4,
          color: color(c.color),
        });
      else if (c.kind === "rect")
        page.drawRectangle({
          x: c.x,
          y: scene.height - c.y - c.height,
          width: c.width,
          height: c.height,
          borderWidth: 0.4,
          borderColor: color(),
          ...(c.fill ? { color: color(c.fill) } : {}),
        });
      else if (c.kind === "circle")
        page.drawCircle({
          x: c.x,
          y: scene.height - c.y,
          size: c.radius,
          color: color(c.color),
          borderColor: color(c.color === "#ffffff" ? "#64748b" : c.color),
          borderWidth: 0.5,
        });
      else if (c.kind === "image") {
        try {
          const png = await doc.embedPng(
              await getFile(`${c.signatureReference}.png`),
            ),
            scale = Math.min(c.width / png.width, c.height / png.height);
          page.drawImage(png, {
            x: c.x + (c.width - png.width * scale) / 2,
            y:
              scene.height -
              c.y -
              c.height +
              (c.height - png.height * scale) / 2,
            width: png.width * scale,
            height: png.height * scale,
          });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT")
            throw new AppError(
              409,
              "File tanda tangan tidak dapat dimuat atau tidak valid",
            );
        }
      }
    }
  }
  doc.setTitle(`Kontrol Suhu ${report.device.type} ${report.device.number}`);
  doc.setSubject("Laporan monitoring suhu");
  doc.setCreationDate(new Date(report.createdAt));
  doc.setModificationDate(new Date(approval?.at || report.createdAt));
  if (certificate && approval)
    pdflibAddPlaceholder({
      pdfDoc: doc,
      reason: "Verifikasi lembar kontrol suhu",
      contactInfo: "",
      name: approval.name,
      location: "Asia/Jakarta",
      signatureLength: 20000,
    });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
export const generateTemperatureControlPdf = generateControlPdf;
