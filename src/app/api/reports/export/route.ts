import { readJson } from "@/lib/server/body";
import { exportWorkbook } from "@/lib/server/excel";
import { z } from "zod";
import { requireActor, rateLimit } from "@/lib/server/auth";
import { ok, fail, originCheck, AppError } from "@/lib/server/errors";
import { locked } from "@/lib/server/storage";
import { createReport } from "@/lib/server/reports";
import { allRecords } from "@/lib/server/sheets";
import { filterRecords, displayDate } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor();
    await rateLimit(`export:${actor.id}`, 30);
    const body = z
      .object({
        format: z.enum(["pdf", "csv", "xlsx"]),
        filters: z.record(z.string(), z.string()).default({}),
        revisionOf: z.union([z.uuid(), z.literal("")]).default(""),
      })
      .parse(await readJson(req));
    const p = new URLSearchParams(body.filters);
    if (body.format === "pdf") {
      const r = await locked(() => createReport(p, actor, body.revisionOf));
      return ok(
        { id: r.id, url: `/api/reports/${r.id}/download` },
        "Snapshot laporan dibuat",
      );
    }
    const records = filterRecords(await allRecords(), p);
    if (records.length > 10000)
      throw new AppError(400, "Persempit periode export");
    const data = [
      [
        "ID",
        "Tanggal",
        "Jam",
        "Jenis",
        "Suhu 1",
        "Suhu 2",
        "Suhu 3",
        "Suhu 4",
        "Suhu 5",
        "Petugas",
        "Status",
        "Keterangan",
      ],
      ...records.map((r) => [
        r.id,
        displayDate(r.date),
        r.time,
        r.kind,
        ...Array.from({ length: 5 }, (_, i) => r.values[i] ?? ""),
        r.officer,
        r.status,
        r.notes,
      ]),
    ];
    if (body.format === "csv") {
      const escape = (v: unknown) =>
        `"${(typeof v === "number"
          ? String(v)
          : String(v).replace(/^[=+@\-\t\r]/, "'$&")
        ).replaceAll('"', '""')}"`;
      return new Response(
        "\uFEFF" + data.map((r) => r.map(escape).join(";")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="temperature-report.csv"',
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return new Response(exportWorkbook(data), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="temperature-report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
