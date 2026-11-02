// UI fixtures only: no session, API requests, or operational measurements.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { TemperatureVerticalSlider } from "../../src/components/temperature/TemperatureVerticalSlider";
function Preview() {
  const [chiller, setChiller] = useState<(number | null)[]>([
    null,
    1.8,
    2.3,
    4.7,
    6.9,
  ]);
  const [freezer, setFreezer] = useState<(number | null)[]>([
    -18.5, -20.7, -17.3, -19.8,
  ]);
  return (
    <ConfigProvider
      theme={{
        components: {
          Slider: { railSize: 8, handleSize: 18, handleSizeHover: 20 },
        },
      }}
    >
      <main style={{ maxWidth: 1240, margin: "auto", padding: 20 }}>
        <p>
          UI TEST FIXTURE · Bukan data Google Sheets · Tidak menyimpan
          pengukuran
        </p>
        {(["chiller", "freezer"] as const).map((type) => (
          <section key={type} className="panel form-panel">
            <h1>Monitoring suhu {type}</h1>
            <div
              className={`grid temperature-vertical-grid temperature-grid-${type}`}
            >
              {(type === "chiller" ? chiller : freezer).map((value, i) => (
                <TemperatureVerticalSlider
                  key={i}
                  type={type}
                  label={`Suhu ${type === "chiller" ? "Chiller" : "Freezer"} ${i + 1}`}
                  value={value}
                  required
                  sop={
                    type === "chiller"
                      ? { min: 0, max: 4 }
                      : { min: -22, max: -18 }
                  }
                  onChange={(v) =>
                    (type === "chiller" ? setChiller : setFreezer)((values) =>
                      values.map((old, j) => (i === j ? v : old)),
                    )
                  }
                />
              ))}
            </div>
          </section>
        ))}
        <output aria-label="Nilai slider">
          {JSON.stringify({ chiller, freezer })}
        </output>
      </main>
    </ConfigProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
