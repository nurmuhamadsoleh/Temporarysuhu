import type {
  ControlPage,
  TemperatureReading,
  TemperaturePlotPoint,
} from "./model";

export type TemperatureLineSegment = {
  from: TemperaturePlotPoint;
  to: TemperaturePlotPoint;
  fromTimestamp: string;
  toTimestamp: string;
};

/** Connect existing marker coordinates, never resample, average or smooth readings. */
export function buildTemperatureLineSegments(
  page: ControlPage,
  readings: TemperatureReading[],
  { connectAcrossGaps = false }: { connectAcrossGaps?: boolean } = {},
): TemperatureLineSegment[] {
  const byId = new Map(readings.map((r) => [r.recordId, r]));
  const markers = new Map(
    page.points.flatMap((point) =>
      point.readingIds.map((id) => [id, point] as const),
    ),
  );
  const timestamp = (date: string, time: string) => `${date}T${time}:00+07:00`;
  const columns = page.columns
    .slice()
    .sort(
      (a, b) =>
        Date.parse(timestamp(a.date, a.time)) -
        Date.parse(timestamp(b.date, b.time)),
    );
  const segments: TemperatureLineSegment[] = [];
  let previous: { point: TemperaturePlotPoint; timestamp: string } | null =
    null;
  for (const column of columns) {
    // Equal timestamps have no known temporal order. Preserve all markers/details,
    // but do not pick one record or imply a trend through an ambiguous slot.
    if (column.readingIds.length > 1) {
      previous = null;
      continue;
    }
    const reading = byId.get(column.readingIds[0]),
      point = reading ? markers.get(reading.recordId) : undefined;
    if (!reading || reading.temperatureCelsius === null || !point) {
      if (!connectAcrossGaps) previous = null;
      continue;
    }
    const actualTimestamp = reading.timestamp;
    if (
      previous &&
      Date.parse(previous.timestamp) < Date.parse(actualTimestamp)
    ) {
      segments.push({
        from: previous.point,
        to: point,
        fromTimestamp: previous.timestamp,
        toTimestamp: actualTimestamp,
      });
    }
    previous = { point, timestamp: actualTimestamp };
  }
  return segments;
}
