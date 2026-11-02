// Offline visual/interaction fixture only; no API or spreadsheet writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { ConfigProvider } from "antd";
import { TemperatureVerticalSlider } from "../src/components/temperature/TemperatureVerticalSlider";
import {
  DeviceCorrectionFields,
  type MeasurementFields,
} from "../src/components/temperature/DeviceCorrectionFields";
import {
  DEFAULT_TEMPERATURE_POLICY,
  emptyDeviceInput,
  getTemperatureStatus,
} from "../src/lib/temperature-policy";
function Fixture() {
  const [values, setValues] = useState<(number | null)[]>([
    0,
    4.1,
    5.1,
    -0.1,
    null,
  ]);
  const { control } = useForm<MeasurementFields>({
    defaultValues: {
      date: "2026-11-02",
      time: "03:00",
      values,
      notes: "",
      devices: Array.from({ length: 5 }, emptyDeviceInput),
    },
  });
  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: "Arial, sans-serif",
          controlHeight: 44,
          fontSize: 14,
        },
      }}
    >
      <main
        className="temperature-form"
        style={{ padding: 16, maxWidth: 1600, margin: "auto" }}
      >
        <h1>DATA UJI - Status suhu & tindakan per perangkat</h1>
        <p>
          Fixture lokal tanpa akses database. Nilai berubah saat slider
          digunakan.
        </p>
        <div className="temperature-vertical-grid">
          {values.map((value, i) => (
            <TemperatureVerticalSlider
              key={i}
              label={`Suhu Chiller ${i + 1}`}
              type="chiller"
              value={value}
              policy={DEFAULT_TEMPERATURE_POLICY}
              onChange={(next) =>
                setValues((current) =>
                  current.map((v, j) => (j === i ? next : v)),
                )
              }
            >
              <DeviceCorrectionFields
                index={i}
                type="chiller"
                value={value}
                policy={DEFAULT_TEMPERATURE_POLICY}
                control={control}
                disabled={false}
              />
            </TemperatureVerticalSlider>
          ))}
        </div>
        <output aria-label="Status perangkat">
          {values
            .map(
              (v) =>
                getTemperatureStatus("chiller", v, DEFAULT_TEMPERATURE_POLICY)
                  .label,
            )
            .join(" | ")}
        </output>
      </main>
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
