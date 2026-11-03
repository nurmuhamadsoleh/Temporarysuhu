import "server-only";
import { z } from "zod";
import { requireActor, rateLimit } from "./auth";
import { originCheck, ok, fail, AppError } from "./errors";
import { readJson } from "./body";
import { locked, getFile } from "./storage";
import { rows } from "./sheets";
import { report, createControlReport, certificateConfigured } from "./reports";
import {
  controlSettings,
  saveControlSettings,
  getControlData,
  createCorrection,
  verifyCorrection,
  checkControlFresh,
} from "./control-records";
import {
  controlFilterSchema,
  reportConfigSchema,
  correctionInputSchema,
} from "@/lib/temperature-report/model";
import type { Actor, Role } from "@/lib/domain";
import type { Snapshot } from "./reports";
import { buildTemperatureReportData } from "./report-data";
type Context = { params: Promise<{ id: string }> };
async function run(
  req: Request,
  roles: Role[] | undefined,
  write: boolean,
  fn: (actor: Actor) => Promise<unknown>,
  lock = true,
) {
  try {
    if (write) originCheck(req);
    const actor = await requireActor(roles);
    await rateLimit(
      `control:${write ? "write" : "read"}:${actor.id}`,
      write ? 30 : 180,
    );
    return ok(await (lock ? locked(() => fn(actor)) : fn(actor)));
  } catch (e) {
    return fail(e);
  }
}
export const previewControl = (req: Request) =>
  run(req, undefined, false, async () => {
    const filter = controlFilterSchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const data = await getControlData(filter);
    return {
      ...data,
      report: await buildTemperatureReportData(data.report),
      certificateConfigured: await certificateConfigured(),
    };
  });
export const saveControl = (req: Request) =>
  run(req, undefined, true, async (actor) => {
    const input = z
      .object({
        filter: controlFilterSchema,
        revisionOf: z.uuid().optional().default(""),
      })
      .strict()
      .parse(await readJson(req));
    const id = z.uuid().parse(req.headers.get("Idempotency-Key"));
    const snapshot = await createControlReport(
      input.filter,
      actor,
      input.revisionOf,
      id,
    );
    return { id: snapshot.id, url: `/api/reports/${snapshot.id}/download` };
  });
export const readControl = (req: Request, c: Context) =>
  run(
    req,
    undefined,
    false,
    async (actor) => {
      const id = z.uuid().parse((await c.params).id),
        saved = await report(id);
      if (!saved.snapshot.control)
        throw new AppError(404, "Laporan ini bukan lembar kontrol suhu");
      const state = await checkControlFresh(saved.snapshot.control, actor);
      return {
        report: await buildTemperatureReportData(saved.snapshot.control),
        ...state,
        status: saved.row[4],
        revisionOf: saved.snapshot.revisionOf,
        certificateConfigured: await certificateConfigured(),
      };
    },
    true,
  );
export const archiveControl = (req: Request) =>
  run(req, undefined, false, async () => {
    const archive = [];
    for (const row of (await rows("REPORTS"))
      .slice(1)
      .filter((r) => r[0])
      .reverse()) {
      const id = z.uuid().parse(row[0]),
        snapshot = JSON.parse(
          (await getFile(`${id}.json`)).toString(),
        ) as Snapshot;
      if (snapshot.control)
        archive.push({
          id,
          createdAt: row[1],
          status: row[4],
          filter: snapshot.control.filter,
          revisionOf: row[9],
        });
    }
    return archive;
  });
export const readControlSettings = (req: Request) =>
  run(req, undefined, false, async () => controlSettings());
export const updateControlSettings = (req: Request) =>
  run(req, ["ADMIN"], true, async (actor) => {
    const input = z
      .object({
        settings: reportConfigSchema,
        version: z.string().min(1).max(100),
      })
      .strict()
      .parse(await readJson(req));
    return saveControlSettings(input.settings, input.version, actor);
  });
export const addCorrection = (req: Request) =>
  run(req, undefined, true, async (actor) =>
    createCorrection(
      correctionInputSchema.parse(await readJson(req)),
      actor,
      z.uuid().parse(req.headers.get("Idempotency-Key")),
    ),
  );
export const approveCorrection = (req: Request, c: Context) =>
  run(req, ["SUPERVISOR", "ADMIN"], true, async (actor) => {
    const id = z.uuid().parse((await c.params).id),
      input = z
        .object({ version: z.string().min(1).max(100) })
        .strict()
        .parse(await readJson(req));
    return verifyCorrection(id, input.version, actor);
  });
