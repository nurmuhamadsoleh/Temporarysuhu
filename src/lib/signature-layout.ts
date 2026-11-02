type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Stroke = Point[] | { points: Point[]; [key: string]: unknown };

/** Preserve the whole drawing when its CSS container shrinks or rotates. */
export function fitSignaturePoints<T extends Stroke>(
  strokes: T[],
  previous: Size,
  next: Size,
): T[] {
  if (!previous.width || !previous.height) return strokes;
  const scale = Math.min(
    next.width / previous.width,
    next.height / previous.height,
  );
  const scalePoints = (points: Point[]) =>
    points.map((point) => ({
      ...point,
      x: point.x * scale,
      y: point.y * scale,
    }));
  // signature_pad v2 returns {color, points}; its legacy typings describe Point[][].
  return strokes.map(
    (stroke) =>
      (Array.isArray(stroke)
        ? scalePoints(stroke)
        : { ...stroke, points: scalePoints(stroke.points) }) as T,
  );
}
