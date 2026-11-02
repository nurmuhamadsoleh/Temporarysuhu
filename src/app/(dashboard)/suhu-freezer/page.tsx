import { requireActor } from "@/lib/server/auth";
import { getSop } from "@/lib/server/sheets";
import { jakartaNow } from "@/lib/domain";
import { MeasurementForm } from "@/components/temperature/MeasurementForm";
export default async function Page() {
  const actor = await requireActor();
  return (
    <>
      <MeasurementForm
        kind="freezer"
        actor={actor}
        initialSop={await getSop()}
        initialMetadata={jakartaNow()}
      />
    </>
  );
}
