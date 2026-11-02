export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    { service: "tempcontrol", status: "alive" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
