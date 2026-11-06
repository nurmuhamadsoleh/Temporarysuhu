"use client";
import {
  measuredDevices,
  measurementValue,
  measurementIndex,
  type TemperatureDeviceConfig,
} from "@/lib/devices";
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
  devices,
}: {
  records: Measurement[];
  kind: Kind;
  devices?: TemperatureDeviceConfig[];
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const r = useMemo(
    () =>
      records
        .filter((r) => r.kind === kind)
        .slice()
        .reverse(),
    [records, kind],
  );
  const sensors = (devices ?? measuredDevices(records, kind)).filter(
    (d) => d.kind === kind && d.active,
  );
  return (
    <>
      <div className="chart-container">
        <Line
          role="img"
          aria-label={`Tren suhu ${config[kind].label}; pilih legenda untuk menampilkan atau menyembunyikan sensor`}
          data={{
            labels: r.map((r) => `${displayDate(r.date)} ${r.time}`),
            datasets: sensors.map((device, i) => ({
              label: device.label,
              hidden: hidden.includes(device.id),
              data: r.map((r) => measurementValue(r, device.number) ?? null),
              borderColor: colors[i % colors.length],
              backgroundColor: colors[i % colors.length],
              borderWidth: 2,
              pointRadius: 3,
              spanGaps: false,
              pointBackgroundColor: r.map((row) => {
                const code =
                  row.deviceStates?.[measurementIndex(row, device.number)]
                    ?.temperatureStatus;
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
                  label: (c) => {
                    const row = r[c.dataIndex],
                      device = sensors[c.datasetIndex],
                      code =
                        row?.deviceStates?.[
                          measurementIndex(row, device.number)
                        ]?.temperatureStatus;
                    return (
                      c.dataset.label +
                      ": " +
                      temperature(c.raw === null ? null : Number(c.raw)) +
                      (code ? " | " + statusPalette[code].label : "")
                    );
                  },
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
        {sensors.map((device, i) => (
          <button
            key={device.id}
            type="button"
            aria-pressed={!hidden.includes(device.id)}
            className="chart-sensor-button"
            onClick={() =>
              setHidden((current) =>
                current.includes(device.id)
                  ? current.filter((index) => index !== device.id)
                  : [...current, device.id],
              )
            }
          >
            <span
              aria-hidden="true"
              style={{ background: colors[i % colors.length] }}
            />
            {device.label}
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
