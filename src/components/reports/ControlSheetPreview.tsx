"use client";
import { useMemo, useState } from "react";
import { Button, Drawer, Select, Space, Tooltip } from "antd";
import {
  buildControlScenes,
  approvalFromVerification,
} from "@/lib/temperature-report/scene";
import type {
  TemperatureReport,
  TemperatureVerification,
} from "@/lib/temperature-report/model";
import { temperature, displayDate } from "@/lib/domain";
export function ControlSheetPreview({
  report,
  verification,
}: {
  report: TemperatureReport;
  verification?: TemperatureVerification | null;
}) {
  const scenes = useMemo(
    () =>
      buildControlScenes(
        report,
        approvalFromVerification(verification || null),
      ),
    [report, verification],
  );
  const [page, setPage] = useState(0),
    [zoom, setZoom] = useState(1.75),
    [selected, setSelected] = useState<string[]>([]);
  const scene = scenes[Math.min(page, scenes.length - 1)];
  return (
    <>
      <Space wrap className="control-preview-toolbar">
        <Select
          aria-label="Halaman lembar kontrol"
          value={Math.min(page, scenes.length - 1)}
          onChange={setPage}
          options={scenes.map((p, i) => ({
            value: i,
            label: `${i + 1}. ${p.label}`,
          }))}
          style={{ width: 300, maxWidth: "100%" }}
        />
        <Button
          onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
          disabled={zoom <= 1}
          aria-label="Zoom out"
        >
          −
        </Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          disabled={zoom >= 2}
          aria-label="Zoom in"
        >
          +
        </Button>
      </Space>
      <p className="caption muted mb-3">
        Geser area lembar pada mobile. Tekan titik untuk seluruh detail. Jam
        tambahan memakai waktu aktual; tanggal kalender tetap.
      </p>
      <div
        className="control-sheet-scroll"
        role="region"
        tabIndex={0}
        aria-label="Preview lembar kontrol; dapat digeser horizontal"
      >
        <svg
          role="group"
          aria-label={`Lembar kontrol ${scene.label}`}
          width={scene.width * zoom}
          height={scene.height * zoom}
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          style={{
            display: "block",
            background: "white",
            fontFamily: "Arial, Helvetica, sans-serif",
            maxWidth: "none",
          }}
        >
          {scene.commands.map((c, i) => {
            if (c.kind === "text")
              return (
                <text
                  key={i}
                  x={c.x}
                  y={c.y + c.size}
                  fontSize={c.size}
                  fontWeight={c.bold ? 700 : 400}
                  textAnchor={c.align === "center" ? "middle" : "start"}
                  pointerEvents="none"
                  fill={c.color || "#172033"}
                >
                  {c.text}
                </text>
              );
            if (c.kind === "line")
              return (
                <line
                  key={i}
                  x1={c.x}
                  y1={c.y}
                  x2={c.x2}
                  y2={c.y2}
                  stroke={c.color || "#657180"}
                  strokeWidth={c.weight || 0.4}
                />
              );
            if (c.kind === "rect")
              return (
                <rect
                  key={i}
                  x={c.x}
                  y={c.y}
                  width={c.width}
                  height={c.height}
                  fill={c.fill || "none"}
                  stroke="#657180"
                  strokeWidth={0.4}
                />
              );
            if (c.kind === "image")
              return (
                <image
                  key={i}
                  href={`/api/signatures/${encodeURIComponent(c.signatureReference)}`}
                  x={c.x}
                  y={c.y}
                  width={c.width}
                  height={c.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              );
            const label = c.readingIds
              ? `${temperature(report.readings.find((r) => r.recordId === c.readingIds![0])!.temperatureCelsius)}; ${c.count || 1} pembacaan`
              : "";
            return c.readingIds ? (
              <Tooltip key={i} title={label}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  className="control-plot-point"
                  onClick={() => setSelected(c.readingIds!)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(c.readingIds!);
                    }
                  }}
                >
                  <circle cx={c.x} cy={c.y} r={12} fill="transparent" />
                  <circle cx={c.x} cy={c.y} r={c.radius} fill={c.color} />
                </g>
              </Tooltip>
            ) : (
              <circle
                key={i}
                cx={c.x}
                cy={c.y}
                r={c.radius}
                fill={c.color}
                stroke={c.color === "#ffffff" ? "#64748b" : c.color}
                strokeWidth={0.5}
              />
            );
          })}
        </svg>
      </div>
      <Drawer
        title="Detail pembacaan sumber"
        open={!!selected.length}
        onClose={() => setSelected([])}
        size="min(560px, calc(100vw - 16px))"
      >
        {report.readings
          .filter((r) => selected.includes(r.recordId))
          .map((r) => (
            <article key={r.recordId} className="account-summary">
              <strong>
                {displayDate(r.date)} · {r.time} WIB ·{" "}
                {temperature(r.temperatureCelsius)}
              </strong>
              <p>
                {r.operatorName} · {r.status}
              </p>
              <p className="caption">
                Record: {r.recordId}
                <br />
                Timestamp: {r.timestamp}
              </p>
              <p className="whitespace-pre-wrap">
                {r.notes || "Tidak ada keterangan."}
              </p>
              {r.signatureReference && (
                <img
                  className="signature-preview"
                  alt={`Tanda tangan ${r.operatorName}`}
                  src={`/api/signatures/${encodeURIComponent(r.signatureReference)}`}
                />
              )}
            </article>
          ))}
      </Drawer>
    </>
  );
}
