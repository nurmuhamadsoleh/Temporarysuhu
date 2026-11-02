import { requireActor } from "@/lib/server/auth";
import { getSop } from "@/lib/server/sheets";
import { ok, fail } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function GET() {
  try {
    await requireActor();
    return ok(await getSop());
  } catch (e) {
    return fail(e);
  }
}
