import { featureReadiness } from "@/lib/server/feature-readiness";
import { requireActor } from "@/lib/server/auth";
import { fail } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireActor(["ADMIN"]);
    const report = await featureReadiness();
    return Response.json(report, {
      status: report.status === "ready" ? 200 : 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return fail(error);
  }
}
