import { readiness } from "@/lib/server/readiness";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const ok = await readiness();
  return Response.json(
    { service: "tempcontrol", status: ok ? "ready" : "unavailable" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
