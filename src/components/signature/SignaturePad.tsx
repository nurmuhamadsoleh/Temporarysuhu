"use client";
import { useEffect, type RefObject } from "react";
import SignatureCanvas from "react-signature-canvas";
import { fitSignaturePoints } from "@/lib/signature-layout";
export function SignaturePad({
  padRef,
  label = "Area menggambar tanda tangan",
}: {
  padRef: RefObject<SignatureCanvas | null>;
  label?: string;
}) {
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    const canvas = pad.getCanvas();
    let previous = { width: 0, height: 0, ratio: 0 };
    let baseline: {
      data: ReturnType<SignatureCanvas["toData"]>;
      size: { width: number; height: number };
    } | null = null;
    let lastRendered = "";
    const resize = () => {
      const data = pad.toData(),
        ratio = Math.max(window.devicePixelRatio || 1, 1),
        rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (
        previous.width === rect.width &&
        previous.height === rect.height &&
        previous.ratio === ratio
      )
        return;
      // Resize from the last edited drawing, so repeated rotations do not
      // progressively shrink the strokes. A new stroke/clear resets this basis.
      if (!baseline || JSON.stringify(data) !== lastRendered) {
        baseline = { data, size: previous.width ? previous : rect };
      }
      const restored = fitSignaturePoints(baseline.data, baseline.size, rect);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.getContext("2d")!.scale(ratio, ratio);
      pad.clear();
      if (restored.length) pad.fromData(restored);
      lastRendered = JSON.stringify(restored);
      previous = { width: rect.width, height: rect.height, ratio };
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [padRef]);
  return (
    <div className="signature-wrap">
      <SignatureCanvas
        ref={padRef}
        penColor="#172554"
        clearOnResize={false}
        canvasProps={{ className: "signature-canvas", "aria-label": label }}
      />
      <span className="signature-hint">
        Tanda tangan di area ini menggunakan mouse atau sentuhan
      </span>
    </div>
  );
}
