"use client";
import { useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import {
  config,
  displayDate,
  temperature,
  type Measurement,
  type Kind,
} from "@/lib/domain";
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
);
import { statusPalette } from "@/lib/temperature-policy";
const colors = ["#0891b2", "#2563eb", "#7c3aed", "#16a34a", "#f59e0b"];
export function Trend({
  records,
  kind,
}: {
  records: Measurement[];
  kind: Kind;
}) {
  const [hidden, setHidden] = useState<number[]>([]);
  const r = useMemo(
    () =>
      records
        .filter((r) => r.kind === kind)
        .slice()
        .reverse(),
    [records, kind],
  );
  return (
    <>
      <div className="chart-container">
        <Line
          role="img"
          aria-label={`Tren suhu ${config[kind].label}; pilih legenda untuk menampilkan atau menyembunyikan sensor`}
          data={{
            labels: r.map((r) => `${displayDate(r.date)} ${r.time}`),
            datasets: Array.from({ length: config[kind].count }, (_, i) => ({
              label: `${config[kind].label} ${i + 1}`,
              hidden: hidden.includes(i),
              data: r.map((r) => r.values[i]),
              borderColor: colors[i],
              backgroundColor: colors[i],
              borderWidth: 2,
              pointRadius: 3,
              spanGaps: false,
              pointBackgroundColor: r.map((row) => {
                const code = row.deviceStates?.[i]?.temperatureStatus;
                return code ? statusPalette[code].color : "#64748B";
              }),
              tension: 0.3,
            })),
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: {
                display: false,
                position: "bottom",
                labels: {
                  usePointStyle: true,
                  boxWidth: 10,
                  padding: 16,
                  font: { size: 12 },
                },
              },
              tooltip: {
                callbacks: {
                  label: (c) =>
                    `${c.dataset.label}: ${temperature(c.raw === null ? null : Number(c.raw))}${r[c.dataIndex]?.deviceStates?.[c.datasetIndex]?.temperatureStatus ? " | " + statusPalette[r[c.dataIndex].deviceStates![c.datasetIndex].temperatureStatus].label : ""}`,
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { maxTicksLimit: 5, font: { size: 12 } },
              },
              y: {
                title: { display: true, text: "Suhu (°C)" },
                ticks: { callback: (v) => temperature(Number(v)) },
                grid: { color: "#f1f5f9" },
              },
            },
          }}
        />
      </div>
      <div
        className="chart-sensor-controls"
        role="group"
        aria-label={`Tampilkan sensor ${config[kind].label}`}
      >
        {Array.from({ length: config[kind].count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={!hidden.includes(i)}
            className="chart-sensor-button"
            onClick={() =>
              setHidden((current) =>
                current.includes(i)
                  ? current.filter((index) => index !== i)
                  : [...current, i],
              )
            }
          >
            <span aria-hidden="true" style={{ background: colors[i] }} />
            {config[kind].label} {i + 1}
          </button>
        ))}
      </div>
    </>
  );
}
export function Comparison({
  chiller,
  freezer,
}: {
  chiller: number | null;
  freezer: number | null;
}) {
  return (
    <div className="chart-container">
      <Bar
        role="img"
        aria-label="Perbandingan rata-rata suhu Chiller dan Freezer"
        data={{
          labels: ["Chiller", "Freezer"],
          datasets: [
            {
              label: "Rata-rata suhu",
              data: [chiller, freezer],
              backgroundColor: ["#06b6d4", "#6366f1"],
              borderRadius: 8,
              maxBarThickness: 55,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c) =>
                  temperature(c.raw === null ? null : Number(c.raw)),
              },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: { callback: (v) => temperature(Number(v)) } },
          },
        }}
      />
    </div>
  );
}
