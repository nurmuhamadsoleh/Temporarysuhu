import { expect, it } from "vitest";
import { fitSignaturePoints } from "@/lib/signature-layout";

it("preserves v2 stroke metadata and fits every point when rotating to a narrower canvas", () => {
  const input = [
    {
      color: "#172554",
      points: [
        { x: 580, y: 180, time: 123 },
        { x: 120, y: 80, time: 124 },
      ],
    },
  ];
  const result = fitSignaturePoints(
    input,
    { width: 600, height: 200 },
    { width: 280, height: 200 },
  );
  expect(result[0].color).toBe(input[0].color);
  expect(result[0].points[0].time).toBe(123);
  expect(result[0].points.every((p) => p.x <= 280 && p.y <= 200)).toBe(true);
  expect(input[0].points[0].x).toBe(580);
});
it("retains legacy point arrays and leaves first layout unchanged", () => {
  const input = [[{ x: 100, y: 50, time: 12 }]];
  expect(
    fitSignaturePoints(
      input,
      { width: 0, height: 0 },
      { width: 300, height: 200 },
    ),
  ).toBe(input);
  expect(
    fitSignaturePoints(
      input,
      { width: 200, height: 100 },
      { width: 100, height: 100 },
    )[0][0],
  ).toEqual({ x: 50, y: 25, time: 12 });
});
