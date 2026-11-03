import { z } from "zod";
import { createHash } from "node:crypto";
import { requireActor, rateLimit } from "@/lib/server/auth";
import { report, generatePdf } from "@/lib/server/reports";
import { putFile } from "@/lib/server/storage";
import { getFile } from "@/lib/server/storage";
import { locked } from "@/lib/server/storage";
import { checkControlFresh } from "@/lib/server/control-records";
import { fail, AppError } from "@/lib/server/errors";
export async function GET(_: Request, c: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    await rateLimit(`pdf-download:${actor.id}`, 60);
    const id = z.uuid().parse((await c.params).id),
      { snapshot, row } = await report(id);
    const controlState = snapshot.control
      ? await locked(() => checkControlFresh(snapshot.control!, actor))
      : null;
    const pdf =
      row[4] === "SIGNED"
        ? await getFile(String(row[7]))
        : await generatePdf(
            snapshot,
            row[5]
              ? {
                  name: String(row[5]),
                  at: String(row[6]),
                  signatureId: String(row[10] || ""),
                  status:
                    controlState &&
                    (!controlState.fresh ||
                      controlState.verification?.status === "INVALIDATED")
                      ? "INVALIDATED"
                      : undefined,
                }
              : undefined,
          );
    if (
      row[4] === "SIGNED" &&
      createHash("sha256").update(pdf).digest("hex") !== row[8]
    )
      throw new AppError(409, "Integritas file laporan tidak sesuai");
    if (snapshot.control && row[4] !== "SIGNED")
      await putFile(
        `${id}.control.${createHash("sha256").update(pdf).digest("hex")}.pdf`,
        pdf,
      );
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(_.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="report-${id}.pdf"`,
        "X-Temperature-Verification":
          controlState &&
          (!controlState.fresh ||
            controlState.verification?.status === "INVALIDATED")
            ? "INVALIDATED"
            : String(row[4]),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
