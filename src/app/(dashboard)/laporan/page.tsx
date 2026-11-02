import { requireActor } from "@/lib/server/auth";
import { jakartaNow } from "@/lib/domain";
import { Reports } from "@/components/reports/Reports";
export default async function Page() {
  return (
    <Reports actor={await requireActor()} initialDate={jakartaNow().date} />
  );
}
