import { wrapReportText } from "./text";
export { wrapReportText } from "./text";
import { buildFullNamePages } from "./name-layout";
import { statusPalette, actionStatusLabels } from "@/lib/temperature-policy";
import { buildTemperatureLineSegments } from "./plot";
import { DEFAULT_REPORT_SUPERVISOR_NAME } from "@/config/report";
import {
  printableReportText,
  monitoringPeriod,
  operationalTemperatureStatus,
  reportOperators,
  reportOperatorKey,
  formatVerificationAt,
} from "./presentation";
import { config, displayDate, temperature } from "@/lib/domain";
import {
  pageSize,
  type TemperatureReport,
  type TemperatureVerification,
} from "./model";
export type DrawCommand =
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      bold?: boolean;
      color?: string;
      align?: "center";
    }
  | {
      kind: "line";
      x: number;
      y: number;
      x2: number;
      y2: number;
      color?: string;
      weight?: number;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill?: string;
    }
  | {
      kind: "circle";
      x: number;
      y: number;
      radius: number;
      color: string;
      readingIds?: string[];
      count?: number;
    }
  | {
      kind: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      signatureReference: string;
    };
export type ReportScene = {
  width: number;
  height: number;
  commands: DrawCommand[];
  label: string;
};
export type ControlApproval = {
  name: string;
  at: string;
  signatureId?: string;
  status?: string;
};
export const shortName = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 3)
    .join("");
const fit = (s: string, max: number) =>
  s.length > max ? s.slice(0, Math.max(0, max - 3)) + "..." : s;
export function buildControlScenes(
  report: TemperatureReport,
  approval?: ControlApproval,
): ReportScene[] {
  const { width: W, height: H } = pageSize(report.settings.paper),
    scenes: ReportScene[] = [],
    M = 24,
    axis = 52,
    usable = W - 2 * M;
  let scene: ReportScene;
  const operators = reportOperators(report);
  const nameContinuations: { date: string; time: string; names: string[] }[] =
    [];
  let operatorDirectoryNeeded = false,
    verificationDirectoryNeeded = false;
  const supervisorName =
    report.presentation?.supervisorName || DEFAULT_REPORT_SUPERVISOR_NAME;
  const text = (
    s: string,
    x: number,
    y: number,
    size = 8,
    bold = false,
    color = "#172033",
  ) =>
    scene.commands.push({
      kind: "text",
      x,
      y,
      text: printableReportText(s),
      size,
      bold,
      color,
    });
  const line = (
    x: number,
    y: number,
    x2: number,
    y2: number,
    color = "#657180",
    weight = 0.4,
  ) => scene.commands.push({ kind: "line", x, y, x2, y2, color, weight });
  const box = (
    x: number,
    y: number,
    width: number,
    height: number,
    fill?: string,
  ) => {
    scene.commands.push({ kind: "rect", x, y, width, height, fill });
  };
  const image = (
    ref: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    if (ref)
      scene.commands.push({
        kind: "image",
        x,
        y,
        width,
        height,
        signatureReference: ref,
      });
  };
  const correctionHeaders = [
    "Tanggal",
    "Waktu",
    "Koreksi / Tindakan",
    "Dilakukan Oleh",
    "Status Tindakan",
    "Pemeriksa",
  ];
  const correctionCells = (a: TemperatureReport["corrections"][number]) => [
    displayDate(a.date),
    a.time + " WIB",
    a.description,
    a.performedByName,
    a.actionStatus ? actionStatusLabels[a.actionStatus] : "Belum dicatat",
    a.verificationStatus === "VERIFIED" && a.verifiedBy
      ? [
          a.verifiedByName,
          a.verifiedAt ? formatVerificationAt(a.verifiedAt) : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ];
  const tableRow = (
    x: number,
    top: number,
    widths: number[],
    cells: string[][],
    font: number,
    lineHeight: number,
    height?: number,
  ) => {
    const h =
      height ?? Math.max(1, ...cells.map((c) => c.length)) * lineHeight + 10;
    let xx = x;
    cells.forEach((lines, j) => {
      box(xx, top, widths[j], h);
      lines.forEach((value, k) =>
        text(value, xx + 4, top + 5 + k * lineHeight, font),
      );
      xx += widths[j];
    });
    return top + h;
  };
  const tableHeader = (
    x: number,
    top: number,
    widths: number[],
    font: number,
  ) => {
    const cells = correctionHeaders.map((v, j) =>
        wrapReportText(v, widths[j] - 8, font),
      ),
      h = Math.max(...cells.map((c) => c.length)) * (font + 3) + 10;
    let xx = x;
    cells.forEach((lines, j) => {
      box(xx, top, widths[j], h, "#edf2f7");
      lines.forEach((v, k) =>
        text(v, xx + 4, top + 5 + k * (font + 3), font, true),
      );
      xx += widths[j];
    });
    return top + h;
  };
  const wrapCorrection = (
    a: TemperatureReport["corrections"][number],
    widths: number[],
    font: number,
  ) =>
    correctionCells(a).map((v, j) =>
      wrapReportText(printableReportText(v), widths[j] - 8, font),
    );
  const start = (label: string) => {
    scene = { width: W, height: H, commands: [], label };
    scenes.push(scene);
    scene.commands.push({
      kind: "text",
      text: `KONTROL SUHU ${config[report.filter.kind].label.toUpperCase()}`,
      x: W / 2,
      y: 20,
      size: 16,
      bold: true,
      align: "center",
    });
    text(`Unit: ${report.company}`, M, 44, 9, true);
    text(
      `Bulan: ${String(report.filter.month).padStart(2, "0")}   Tahun: ${report.filter.year}   Perangkat: ${config[report.filter.kind].label} ${report.filter.deviceNumber}`,
      M,
      61,
      9,
    );
    text(
      `Suhu Normal: ${report.sop ? `${temperature(report.sop.min)} s/d ${temperature(report.sop.max)}` : report.normalRangeNote || "Belum ditetapkan"}`,
      M,
      78,
      9,
    );
    text(
      `No. Cold Storage: ${report.device.coldStorage === "BELUM DIKONFIGURASI" ? "-" : fit(report.device.coldStorage, 70)}`,
      W * 0.52,
      44,
      9,
    );
    text(`Lembar: ${label}`, W * 0.52, 61, 9);
  };
  buildFullNamePages(report).forEach(
    ({ page, nameCells, nameHeight }, pageIndex) => {
      start(
        `${pageIndex + 1} | ${displayDate(page.columns[0].date)} - ${displayDate(page.columns.at(-1)!.date)}`,
      );
      let lx = M;
      for (const [label, color] of [
        ["Normal", statusPalette.NORMAL.color],
        ["Warning", statusPalette.WARNING.color],
        ["Suhu tinggi", statusPalette.HIGH_TEMPERATURE.color],
        ["Suhu rendah", statusPalette.LOW_TEMPERATURE.color],
        ["Belum diisi / SOP belum ditetapkan", "#64748B"],
        ["Tidak ada catatan", "#ffffff"],
      ]) {
        scene.commands.push({
          kind: "circle",
          x: lx + 3,
          y: 106,
          radius: 2.7,
          color,
        });
        text(label, lx + 10, 101, 8);
        lx += label.length * 4.1 + 28;
      }
      line(lx, 106, lx + 18, 106, "#2563EB", 2);
      text("Tren", lx + 23, 101, 8);
      const gx = M + axis,
        top = 122,
        dayH = 18,
        timeH = 20,
        plotY = top + dayH + timeH,
        plotH = (H > 600 ? 400 : 190) - (nameHeight - 26),
        nameY = plotY + plotH,
        paraY = nameY + nameHeight,
        bottom = paraY + 34;
      const gw = usable - axis,
        cw = gw / page.columns.length;
      box(M, top, usable, bottom - top);
      box(M, top, axis, dayH + timeH, "#edf2f7");
      text("SUHU", M + 10, top + 6, 8, true);
      text("(Celsius)", M + 7, top + 20, 8);
      let i = 0;
      while (i < page.columns.length) {
        let end = i + 1;
        while (
          end < page.columns.length &&
          page.columns[end].date === page.columns[i].date
        )
          end++;
        box(gx + i * cw, top, (end - i) * cw, dayH, "#edf2f7");
        text(
          displayDate(page.columns[i].date),
          gx + i * cw + 4,
          top + 4,
          8,
          true,
        );
        i = end;
      }
      const marks = [...config[report.filter.kind].options].reverse();
      for (const mark of marks) {
        const y =
          plotY +
          ((config[report.filter.kind].max - mark) /
            (config[report.filter.kind].max - config[report.filter.kind].min)) *
            plotH;
        text(
          `${mark}°C`,
          M + 9,
          Math.max(plotY + 3, Math.min(plotY + plotH - 11, y - 4)),
          8,
          true,
        );
        line(gx, y, W - M, y, "#64748b", 0.55);
      }
      // Minor grid lines at 1 degree; primary labels remain every 2 degrees.
      for (
        let n = config[report.filter.kind].min + 1;
        n < config[report.filter.kind].max;
        n += 2
      ) {
        const y = plotY + ((config[report.filter.kind].max - n) / 16) * plotH;
        line(gx, y, W - M, y, "#cbd5e1", 0.25);
      }
      text("Nama", M + 4, nameY + 3, 7.5, true);
      text("Petugas", M + 4, nameY + 14, 7.5, true);
      text("Paraf", M + 10, paraY + 12, 8, true);
      line(M, nameY, W - M, nameY);
      line(M, paraY, W - M, paraY);
      line(gx, top, gx, bottom);
      page.columns.forEach((column, j) => {
        const x = gx + j * cw;
        line(x, top + dayH, x, nameY, "#94a3b8", 0.35);
        line(x, paraY, x, bottom, "#94a3b8", 0.35);
        if (nameCells.some((cell) => cell.start === j))
          line(x, nameY, x, paraY, "#94a3b8", 0.35);
        text(
          column.time,
          x + 3,
          top + dayH + 6,
          7.5,
          false,
          column.scheduled ? "#172033" : "#92400e",
        );
        const readings = report.readings.filter((r) =>
          column.readingIds.includes(r.recordId),
        );
        if (!readings.length) return;
        if (readings.every((r) => r.temperatureCelsius === null)) {
          text("BELUM", x + 2, plotY + 6, 6.8, false, "#64748B");
          text("DIISI", x + 2, plotY + 15, 6.8, false, "#64748B");
        }
        if (readings.length === 1)
          image(readings[0].signatureReference, x + 2, paraY + 3, cw - 4, 28);
        else text(`${readings.length} detail`, x + 2, paraY + 11, 7);
      });
      for (const cell of nameCells) {
        cell.lines.forEach((name, i) =>
          text(name, gx + cell.start * cw + 4, nameY + 5 + i * 10, 8),
        );
        if (cell.continued) {
          const column = page.columns[cell.start];
          nameContinuations.push({
            date: column.date,
            time: column.time,
            names: cell.names,
          });
        }
      }
      for (const segment of buildTemperatureLineSegments(
        page,
        report.readings,
        {
          connectAcrossGaps: report.settings.connectAcrossGaps ?? false,
        },
      )) {
        line(
          gx + segment.from.x * gw,
          plotY + Math.max(0, Math.min(1, segment.from.y)) * plotH,
          gx + segment.to.x * gw,
          plotY + Math.max(0, Math.min(1, segment.to.y)) * plotH,
          "#2563EB",
          2,
        );
      }
      page.points.forEach((point) => {
        const x = gx + point.x * gw,
          y = plotY + Math.max(0, Math.min(1, point.y)) * plotH,
          color =
            point.status in statusPalette
              ? statusPalette[point.status as keyof typeof statusPalette].color
              : point.status === "ALERT"
                ? "#DC2626"
                : point.status === "NORMAL"
                  ? "#15803d"
                  : "#64748B";
        scene.commands.push({
          kind: "circle",
          x,
          y,
          radius: point.count > 1 ? 5 : 4,
          color,
          readingIds: point.readingIds,
          count: point.count,
        });
        if (point.count > 1)
          text(String(point.count), x - 2, y - 3, 6, true, "#ffffff");
        else if (
          cw >= 34 &&
          page.columns.find((column) =>
            column.readingIds.includes(point.readingIds[0]),
          )?.readingIds.length === 1
        )
          text(
            temperature(point.temperatureCelsius),
            x + 4,
            y - 9,
            7.5,
            false,
            color,
          );
        if (point.y < 0 || point.y > 1)
          text("!", x - 2, y - 13, 9, true, color);
      });
      const noteY = bottom + 16;
      text("Verifikasi", M, noteY, 9, true);
      text(
        approval?.status === "INVALIDATED"
          ? "TIDAK BERLAKU - PERLU REVISI"
          : approval
            ? "TERVERIFIKASI"
            : "BELUM DIVERIFIKASI",
        M,
        noteY + 14,
        8,
        true,
      );
      const longSupervisor = supervisorName.length > 42,
        longVerifier = (approval?.name.length || 0) > 42;
      if (longSupervisor || longVerifier) verificationDirectoryNeeded = true;
      text(
        `Nama Supervisor: ${longSupervisor ? "lihat Rincian Verifikasi" : supervisorName}`,
        M,
        noteY + 28,
        8,
      );
      text(monitoringPeriod(report), M, noteY + 41, 8);
      if (approval) {
        text(
          `Diverifikasi oleh: ${longVerifier ? "lihat Rincian Verifikasi" : approval.name}`,
          M,
          noteY + 53,
          7.5,
        );
        text(
          `Tanggal verifikasi: ${formatVerificationAt(approval.at)}`,
          M,
          noteY + 65,
          7.4,
        );
        image(approval.signatureId || "", M + 75, noteY + 80, 100, 18);
      }
      const ax = M + 260,
        aw = W - M - ax,
        headerY = noteY;
      text(
        "Koreksi dan Tindakan Korektif (detail lengkap di lampiran)",
        ax,
        headerY,
        8.5,
        true,
      );
      const widths = [0.13, 0.1, 0.32, 0.16, 0.14, 0.15].map((r) => r * aw),
        related = new Set(page.columns.flatMap((c) => c.readingIds));
      const actions = report.corrections.filter((a) => related.has(a.recordId));
      let tableY = tableHeader(ax, headerY + 14, widths, 6.8),
        shown = 0;
      const limit = H - 70;
      if (!actions.length) {
        for (let i = 0; i < 3; i++)
          tableY = tableRow(
            ax,
            tableY,
            widths,
            Array.from({ length: 6 }, () => []),
            7,
            9,
            16,
          );
      } else {
        for (const action of actions) {
          const cells = wrapCorrection(action, widths, 7),
            height = Math.max(...cells.map((c) => c.length)) * 9 + 10,
            remaining = actions.length - shown - 1;
          if (tableY + height + (remaining ? 16 : 0) > limit) break;
          tableY = tableRow(ax, tableY, widths, cells, 7, 9, height);
          shown++;
        }
        if (shown < actions.length) {
          box(ax, tableY, aw, 16);
          text(
            `${actions.length - shown} tindakan lainnya: lihat tabel lanjutan Koreksi dan Tindakan Korektif.`,
            ax + 4,
            tableY + 4,
            7,
          );
        }
      }
      const footerNote = H - 66;
      text("Notes: (X) Defrost  |  (Y) Pekerjaan Perbaikan", M, footerNote, 8);

      text(
        report.settings.correctionSopApproved
          ? "Correction / SOP resmi: lihat lampiran SOP yang disahkan administrator."
          : "SOP tindakan korektif: belum ditetapkan.",
        ax,
        footerNote,
        8,
      );
      const ids = new Set(page.columns.flatMap((c) => c.readingIds));
      const keys = new Set(
        report.readings
          .filter((r) => ids.has(r.recordId))
          .map(reportOperatorKey),
      );
      const legend = operators
        .filter((op) => keys.has(op.key))
        .map((op) => op.name)
        .join("; ");
      const legendLines = legend
        ? wrapReportText("Petugas: " + legend, usable, 8 / 0.56, 1)
        : [];
      if (legendLines.length <= 2)
        legendLines.forEach((line, i) => text(line, M, H - 50 + i * 10, 8));
      else {
        operatorDirectoryNeeded = true;
        text(
          "Nama lengkap petugas tercantum pada Daftar Petugas.",
          M,
          H - 50,
          8,
        );
      }
      text(`Jadwal WIB: ${report.settings.schedule.join(" | ")}`, M, H - 23, 8);
      if (!report.readings.length)
        text(
          "Belum ada data pengukuran pada periode/perangkat ini.",
          gx + 12,
          plotY + plotH / 2,
          10,
        );
    },
  );
  // A full appendix retains identities, decimal values, missing-signature notices,
  // notes, and all duplicates without squeezing them into a tiny grid cell.
  let y = 0;
  const appendPage = (title: string) => {
    start(title);
    y = 110;
  };
  if (nameContinuations.length) {
    appendPage("Nama Petugas (lanjutan)");
    for (const entry of nameContinuations) {
      if (y > H - 80) appendPage("Nama Petugas (lanjutan)");
      text(
        `Tanggal: ${displayDate(entry.date)} | Waktu: ${entry.time} WIB`,
        M,
        y,
        9,
        true,
      );
      y += 18;
      for (const name of entry.names) {
        for (const line of wrapReportText(name, usable, 9 / 0.56, 1)) {
          if (y > H - 45) {
            appendPage("Nama Petugas (lanjutan)");
            text(
              `Tanggal: ${displayDate(entry.date)} | Waktu: ${entry.time} WIB`,
              M,
              y,
              9,
              true,
            );
            y += 18;
          }
          text(line, M, y, 9);
          y += 13;
        }
        y += 5;
      }
    }
  }
  if (operatorDirectoryNeeded) {
    appendPage("Daftar Petugas");
    for (const op of operators) {
      for (const line of wrapReportText(op.name, usable, 10 / 0.56, 1)) {
        if (y > H - 50) appendPage("Daftar Petugas (lanjutan)");
        text(line, M, y, 10);
        y += 15;
      }
      y += 10;
    }
  }
  if (verificationDirectoryNeeded) {
    appendPage("Rincian Verifikasi");
    for (const line of wrapReportText(
      `Nama Supervisor: ${supervisorName}`,
      usable,
      10,
    )) {
      text(line, M, y, 10);
      y += 15;
    }
    text(monitoringPeriod(report), M, y + 5, 10);
    y += 30;
    if (approval) {
      for (const line of wrapReportText(
        `Diverifikasi oleh: ${approval.name}`,
        usable,
        10,
      )) {
        text(line, M, y, 10);
        y += 15;
      }
      text(
        `Tanggal verifikasi: ${formatVerificationAt(approval.at)}`,
        M,
        y + 5,
        9,
      );
      image(approval.signatureId || "", M, y + 25, 160, 55);
    }
  }
  if (report.readings.length) appendPage("Detail pengukuran");
  for (const r of report.readings) {
    const status = operationalTemperatureStatus(r, report);
    const rows = [
      `Tanggal: ${displayDate(r.date)}`,
      `Waktu: ${r.time} WIB`,
      `Suhu: ${temperature(r.temperatureCelsius)}`,
      ...wrapReportText(
        `Nama Petugas: ${r.operatorFullName || r.operatorName}`,
        usable - 140,
        8.5 / 0.56,
        1,
      ),
      ...(status ? [`Status: ${status}`] : []),
      ...(r.notes
        ? wrapReportText(`Keterangan: ${r.notes}`, usable - 140, 8.5)
        : []),
    ];
    const height = Math.max(76, rows.length * 12 + 16);
    if (y + height > H - 40) appendPage("Detail pengukuran (lanjutan)");
    rows.forEach((line, j) => text(line, M, y + j * 12, 8.5));
    image(r.signatureReference, W - M - 120, y + 13, 110, 38);
    y += height;
    line(M, y - 9, W - M, y - 9, "#cbd5e1");
  }
  if (report.corrections.length) {
    const widths = [0.105, 0.075, 0.4, 0.16, 0.115, 0.145].map(
        (r) => r * usable,
      ),
      font = 8.5,
      lineHeight = 11;
    let correctionPage = 0;
    const nextCorrectionPage = () => {
      appendPage(
        correctionPage++
          ? "Koreksi dan Tindakan Korektif (lanjutan)"
          : "Koreksi dan Tindakan Korektif",
      );
      y = tableHeader(M, y, widths, 8.5);
    };
    nextCorrectionPage();
    for (const action of report.corrections) {
      const cells = wrapCorrection(action, widths, font),
        length = Math.max(1, ...cells.map((c) => c.length)),
        height = length * lineHeight + 10;
      const freshCapacity = H - 40 - 134;
      if (y + height > H - 40 && (height <= freshCapacity || y > 160))
        nextCorrectionPage();
      let offset = 0;
      while (offset < length) {
        let capacity = Math.floor((H - 40 - y - 10) / lineHeight);
        if (capacity < 1) {
          nextCorrectionPage();
          capacity = Math.floor((H - 40 - y - 10) / lineHeight);
        }
        const take = Math.min(capacity, length - offset);
        const part = cells.map((lines, j) => {
          const chunk = lines.slice(offset, offset + take);
          return offset && j !== 2 && !chunk.length
            ? lines.slice(0, Math.min(lines.length, take))
            : chunk;
        });
        y = tableRow(
          M,
          y,
          widths,
          part,
          font,
          lineHeight,
          take * lineHeight + 10,
        );
        offset += take;
        if (offset < length) nextCorrectionPage();
      }
    }
  }
  if (
    report.settings.correctionSopApproved &&
    report.settings.correctionSopText
  ) {
    appendPage("SOP tindakan korektif");
    for (const s of wrapReportText(
      report.settings.correctionSopText,
      usable,
      9,
    )) {
      if (y > H - 45) appendPage("SOP tindakan korektif (lanjutan)");
      text(s, M, y, 9);
      y += 13;
    }
  }
  scenes.forEach((p, i) => {
    scene = p;
    text(`Halaman ${i + 1}/${scenes.length}`, M, H - 12, 7);
  });
  return scenes;
}
export function approvalFromVerification(
  v: TemperatureVerification | null,
): ControlApproval | undefined {
  return v
    ? {
        name: v.name,
        at: v.verifiedAt,
        signatureId: v.signatureReference,
        status: v.status,
      }
    : undefined;
}
