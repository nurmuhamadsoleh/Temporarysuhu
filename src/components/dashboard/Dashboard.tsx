"use client";
import { useState } from "react";
import Link from "next/link";
import { subDays, format } from "date-fns";
import {
  RefreshCw,
  Plus,
  Thermometer,
  Snowflake,
  TriangleAlert,
  FileCheck,
  ArrowUpRight,
  CalendarDays,
} from "lucide-react";
import { useData, Loading, ErrorBox, Empty, Status } from "@/components/ui";
import dynamic from "next/dynamic";
const Trend = dynamic(
  () => import("@/components/charts/TemperatureCharts").then((m) => m.Trend),
  {
    loading: () => (
      <div
        className="chart-container animate-pulse bg-slate-50"
        aria-label="Memuat grafik"
      />
    ),
  },
);
const Comparison = dynamic(
  () =>
    import("@/components/charts/TemperatureCharts").then((m) => m.Comparison),
  {
    loading: () => (
      <div
        className="chart-container animate-pulse bg-slate-50"
        aria-label="Memuat grafik"
      />
    ),
  },
);
import {
  jakartaNow,
  temperature,
  displayDate,
  type Measurement,
  type Sop,
} from "@/lib/domain";
import {
  statusPalette,
  type TemperatureStatusCode,
} from "@/lib/temperature-policy";
import type { TemperatureDeviceConfig } from "@/lib/devices";
type Data = {
  devices: TemperatureDeviceConfig[];
  records: Measurement[];
  sop: Sop;
  statistics: {
    chillerCount: number;
    freezerCount: number;
    chillerAverage: number | null;
    freezerAverage: number | null;
    alerts: number;
    freezerStatusCounts: Record<TemperatureStatusCode, number>;
    signedReports: number;
  };
};
export function Dashboard() {
  const today = jakartaNow().date,
    [period, setPeriod] = useState("7"),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [kind, setKind] = useState("all");
  const start =
    period === "custom"
      ? from
      : format(
          subDays(new Date(`${today}T12:00:00`), Number(period) - 1),
          "yyyy-MM-dd",
        );
  const { data, error, loading, refresh } = useData<Data>(
    `/api/dashboard/stats?from=${start}&to=${period === "custom" ? to : today}&kind=${kind}`,
  );
  const s = data?.statistics;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OVERVIEW</span>
          <h1>Dashboard monitoring</h1>
          <p>Pantau suhu penyimpanan. Jaga kualitas setiap hari.</p>
        </div>
        <Link href="/suhu-chiller" className="btn primary">
          <Plus size={18} />
          Catat pengukuran
        </Link>
      </div>
      <div className="filter-bar">
        <div className="flex items-center gap-2 text-slate-500">
          <CalendarDays size={18} />
          <strong>Periode monitoring</strong>
        </div>
        <div className="segmented">
          {[
            ["1", "Hari ini"],
            ["7", "7 hari"],
            ["30", "30 hari"],
            ["custom", "Kustom"],
          ].map(([v, t]) => (
            <button
              key={v}
              className={period === v ? "selected" : ""}
              onClick={() => setPeriod(v)}
            >
              {t}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <>
            <input
              aria-label="Tanggal mulai"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <input
              aria-label="Tanggal akhir"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
        <select
          aria-label="Jenis perangkat"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">Semua perangkat</option>
          <option value="chiller">Chiller</option>
          <option value="freezer">Freezer</option>
        </select>
        <button
          className="icon-btn"
          aria-label="Refresh data"
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        data &&
        s && (
          <>
            {(!data.sop.chiller || !data.sop.freezer) && (
              <div className="sop-notice">
                <TriangleAlert size={18} />
                Batas SOP belum lengkap. Status suhu menggunakan BELUM
                DIKONFIGURASI hingga Administrator menetapkan batas aman.
              </div>
            )}
            <div className="stats-grid">
              {[
                {
                  label: "Pengukuran Chiller",
                  value: s.chillerCount,
                  icon: Thermometer,
                  color: "cyan",
                  sub: "Total pengukuran periode ini",
                },
                {
                  label: "Pengukuran Freezer",
                  value: s.freezerCount,
                  icon: Snowflake,
                  color: "indigo",
                  sub: "Total pengukuran periode ini",
                },
                {
                  label: "Rata-rata Chiller",
                  value:
                    s.chillerAverage === null
                      ? "—"
                      : temperature(s.chillerAverage),
                  icon: Thermometer,
                  color: "cyan",
                  sub: "Seluruh sensor Chiller",
                },
                {
                  label: "Rata-rata Freezer",
                  value:
                    s.freezerAverage === null
                      ? "—"
                      : temperature(s.freezerAverage),
                  icon: Snowflake,
                  color: "indigo",
                  sub: "Seluruh sensor Freezer",
                },
                {
                  label: "Pembacaan di luar SOP",
                  value: s.alerts,
                  icon: TriangleAlert,
                  color: "amber",
                  sub:
                    kind === "chiller"
                      ? "Pembacaan sensor · SOP saat ini"
                      : "Freezer memakai penilaian SOP saat pencatatan",
                },
                {
                  label: "Laporan ditandatangani",
                  value: s.signedReports,
                  icon: FileCheck,
                  color: "green",
                  sub: "Sertifikat digital · semua periode",
                },
              ].map((c) => (
                <div key={c.label} className="stat-card">
                  <div className="stat-top">
                    <span>{c.label}</span>
                    <span className={`stat-icon ${c.color}`}>
                      <c.icon size={19} />
                    </span>
                  </div>
                  <strong className="stat-value">{c.value}</strong>
                  <small>{c.sub}</small>
                </div>
              ))}
            </div>
            {kind !== "chiller" && (
              <section
                className="panel mb-5"
                aria-label="Ringkasan status Freezer"
              >
                <div className="panel-title">
                  <div>
                    <h2>Status pembacaan Freezer</h2>
                    <p>Menggunakan versi SOP saat pengukuran dicatat.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {(
                    [
                      "NORMAL",
                      "WARNING",
                      "HIGH_TEMPERATURE",
                      "LOW_TEMPERATURE",
                    ] as const
                  ).map((code) => (
                    <div
                      key={code}
                      className="rounded-xl p-4"
                      style={{ background: statusPalette[code].background }}
                    >
                      <span style={{ color: statusPalette[code].color }}>
                        {statusPalette[code].label}
                      </span>
                      <strong
                        className="block text-2xl"
                        style={{ color: statusPalette[code].color }}
                      >
                        {s.freezerStatusCounts[code]}
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="caption mt-3">
                  Belum diisi: {s.freezerStatusCounts.UNFILLED} · Tanpa
                  penilaian SOP tersimpan: {s.freezerStatusCounts.UNKNOWN_SOP}
                </p>
              </section>
            )}
            <div className="grid gap-5 xl:grid-cols-2">
              {(["chiller", "freezer"] as const).map((k) => (
                <section key={k} className="panel">
                  <div className="panel-title">
                    <div>
                      <h2>
                        {k === "chiller" ? "Chiller" : "Freezer"} temperature
                        trend
                      </h2>
                      <p>Perubahan suhu setiap waktu pengukuran</p>
                    </div>
                    <span
                      className={`tag ${k === "chiller" ? "cyan" : "indigo"}`}
                    >
                      {k === "chiller" ? "5" : "4"} sensor
                    </span>
                  </div>
                  {data.records.some((r) => r.kind === k) ? (
                    <Trend
                      records={data.records}
                      kind={k}
                      devices={data.devices}
                    />
                  ) : (
                    <Empty />
                  )}
                </section>
              ))}
            </div>
            <div className="grid gap-5 mt-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <h2>Temperature comparison</h2>
                    <p>Rata-rata suhu per perangkat</p>
                  </div>
                </div>
                {data.records.length ? (
                  <Comparison
                    chiller={s.chillerAverage}
                    freezer={s.freezerAverage}
                  />
                ) : (
                  <Empty />
                )}
              </section>
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <h2>Monitoring history</h2>
                    <p>10 pengukuran terbaru pada periode terpilih</p>
                  </div>
                  <Link href="/laporan" className="text-link">
                    Lihat semua
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
                {data.records.length ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label="Tabel data; geser horizontal untuk kolom lainnya"
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Waktu</th>
                          <th>Perangkat</th>
                          <th>Petugas</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.records.slice(0, 10).map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{displayDate(r.date)}</strong>
                              <small>{r.time} WIB</small>
                            </td>
                            <td>
                              <span
                                className={`tag ${r.kind === "chiller" ? "cyan" : "indigo"}`}
                              >
                                {r.kind}
                              </span>
                            </td>
                            <td>{r.officer}</td>
                            <td>
                              <Status value={r.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty />
                )}
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
