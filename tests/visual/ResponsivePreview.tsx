// Test fixtures only. Requests never reach production APIs or Google Sheets.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { UIProvider } from "../../src/components/layout/UIProvider";

import { AuthFrame } from "../../src/components/auth/AuthFrame";
import { GoogleButton } from "../../src/components/auth/GoogleButton";
import { Shell } from "../../src/components/layout/Shell";
import { Dashboard } from "../../src/components/dashboard/Dashboard";
import { MeasurementForm } from "../../src/components/temperature/MeasurementForm";
import { Reports } from "../../src/components/reports/Reports";
import { Admin } from "../../src/components/Admin";
import { UsersManagement } from "../../src/components/users/UsersManagement";
import type { Actor, Measurement } from "../../src/lib/domain";
import { fixtureRecord, fixtureReport } from "../control-fixtures";
import {
  controlFilterSchema,
  defaultReportConfig,
  normalizeReadings,
  makeControlPages,
  type ControlFilter,
} from "../../src/lib/temperature-report/model";
const controlRecords = [fixtureRecord("chiller"), fixtureRecord("freezer")];
const controlId = "11111111-1111-4111-8111-111111111111";
const controlFixture = (filter: ControlFilter, id = "PREVIEW") => {
  const report = fixtureReport(
    filter.kind,
    filter.deviceNumber,
    controlRecords,
  );
  report.filter = filter;
  report.id = id;
  report.readings = normalizeReadings(controlRecords, filter, {
    chiller: { min: 0, max: 4 },
    freezer: { min: -22, max: -18 },
  });
  report.pages = makeControlPages(report.readings, filter, report.settings);
  return report;
};
const actor: Actor = {
  id: "ui-test",
  name: "Petugas Pengujian Tampilan",
  email: "ui-test@example.test",
  role: "SUPER_ADMIN",
};
const sop = { chiller: { min: 0, max: 4 }, freezer: { min: -22, max: -18 } };
const records: Measurement[] = (["chiller", "freezer"] as const).map(
  (kind) => ({
    id: `ui-${kind}`,
    kind,
    date: "2026-11-01",
    time: "09:15",
    values:
      kind === "chiller"
        ? [0, 1.8, 2.3, 4.7, 6.9]
        : [-18.5, -20.7, -17.3, -19.8],
    notes:
      "UI TEST FIXTURE — bukan data operasional. Keterangan panjang untuk memeriksa pembungkusan teks.",
    status: "ALERT",
    signatureId: "ui-signature",
    officer: actor.name,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdAt: "2026-11-01T02:15:00Z",
    updatedAt: "2026-11-01T02:15:00Z",
  }),
);
const user = {
  id: actor.id,
  googleId: "ui-google",
  name: actor.name,
  email: actor.email,
  picture: "",
  role: "SUPER_ADMIN",
  status: "ACTIVE",
  registeredAt: "2026-11-01T02:15:00Z",
  approvedAt: "2026-11-01T02:15:00Z",
  approvedBy: "ui-test",
  lastLogin: "2026-11-01T02:15:00Z",
  updatedAt: "2026-11-01T02:15:00Z",
  createdBy: "ui-test",
  updatedBy: "ui-test",
};
const signature =
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="100"><text x="20" y="50" fill="#334155">UI TEST SIGNATURE</text></svg>';
const fixtureFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method && init.method !== "GET")
    return Response.json(
      { success: false, message: "Fixture tidak mengizinkan penyimpanan" },
      { status: 403 },
    );
  if (/\/api\/reports\/[a-f0-9-]+\/download/.test(url))
    return fixtureFetch(url);
  if (url.startsWith("/api/signatures/"))
    return new Response(signature, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  let data: unknown;
  if (url.startsWith("/api/dashboard/"))
    data = {
      records,
      sop,
      statistics: {
        chillerCount: 1,
        freezerCount: 1,
        chillerAverage: 3.1,
        freezerAverage: -19.1,
        alerts: 3,
        signedReports: 0,
      },
    };
  else if (url.startsWith("/api/temperatures/config")) data = sop;
  else if (url.startsWith("/api/temperatures/"))
    data = records.filter((r) => url.includes(r.kind));
  else if (url.startsWith("/api/reports/control/config"))
    data = { settings: defaultReportConfig, version: "ui-test" };
  else if (url.startsWith("/api/reports/control/archive"))
    data = [
      {
        id: controlId,
        createdAt: "2026-11-01T00:00:00Z",
        status: "DRAFT",
        filter: {
          kind: "chiller",
          deviceNumber: 1,
          month: 11,
          year: 2026,
          coldStorage: "",
          officer: "",
        },
        revisionOf: "",
      },
    ];
  else if (url.startsWith("/api/reports/control/"))
    data = {
      report: controlFixture(
        {
          kind: "chiller",
          deviceNumber: 1,
          month: 11,
          year: 2026,
          coldStorage: "",
          officer: "",
        },
        controlId,
      ),
      fresh: true,
      verification: null,
      status: "DRAFT",
      certificateConfigured: false,
    };
  else if (url.startsWith("/api/reports/control?")) {
    const filter = controlFilterSchema.parse(
      Object.fromEntries(new URL(url, location.origin).searchParams),
    );
    data = { report: controlFixture(filter), certificateConfigured: false };
  } else if (url.startsWith("/api/reports"))
    data = {
      records,
      reports: [
        {
          id: "UI-REPORT-ONLY",
          createdAt: user.registeredAt,
          status: "DRAFT",
          approver: "",
          approvedAt: "",
          revisionOf: "",
        },
      ],
      certificateConfigured: false,
    };
  else if (url.startsWith("/api/users/")) data = { user, activity: [] };
  else if (url.startsWith("/api/users"))
    data = [
      user,
      {
        ...user,
        id: "ui-pending",
        name: "Pendaftaran Pengujian",
        email: "long-test-address-for-responsive-check@example.test",
        role: "PETUGAS",
        status: "PENDING",
      },
    ];
  else if (url.startsWith("/api/admin"))
    data = {
      sop,
      audit: [
        [
          "ui-audit",
          user.registeredAt,
          actor.id,
          "UI_TEST",
          "ui-record",
          "{}",
          "{}",
        ],
      ],
    };
  else
    return Response.json(
      { success: false, message: "Tidak ada API operasional di fixture" },
      { status: 404 },
    );
  return Response.json({ success: true, data });
};
const routes = [
  "/login",
  "/register",
  "/pending",
  "/account-status",
  "/dashboard",
  "/suhu-chiller",
  "/suhu-freezer",
  "/laporan",
  "/dashboard/users",
  "/pengaturan",
];
function Preview() {
  const [route, setRoute] = useState(
    new URL(location.href).searchParams.get("route") || "/dashboard",
  );
  const change = (value: string) => {
    history.replaceState(null, "", `?route=${encodeURIComponent(value)}`);
    setRoute(value);
  };
  const auth =
    route === "/login" ||
    route === "/register" ||
    route === "/pending" ||
    route === "/account-status";
  return (
    <UIProvider>
      <div
        className="ui-test-banner"
        style={{
          padding: 8,
          background: "#fef3c7",
          color: "#713f12",
          fontSize: 12,
        }}
      >
        UI TEST FIXTURE · Tidak terhubung ke database ·{" "}
        <select
          aria-label="Halaman uji"
          value={route}
          onChange={(e) => change(e.target.value)}
          style={{ width: "auto", maxWidth: "100%" }}
        >
          {routes.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      {auth ? (
        <AuthFrame>
          <span className="eyebrow">TEMPCONTROL</span>
          <h2>
            {route === "/login"
              ? "Masuk ke Workspace TempControl"
              : route === "/register"
                ? "Buat Akun TempControl"
                : route === "/pending"
                  ? "Registrasi Berhasil"
                  : "Akses belum tersedia"}
          </h2>
          <p className="muted">
            {route === "/pending"
              ? "Akun Google Anda telah terdaftar dan sedang menunggu persetujuan administrator PT Boga Rasa Tama."
              : "Gunakan akun Google yang telah terdaftar untuk mengakses sistem monitoring suhu."}
          </p>
          {route === "/login" || route === "/register" ? (
            <GoogleButton configured={false} register={route === "/register"} />
          ) : (
            <div className="account-summary">
              <strong>{actor.name}</strong>
              <p>{actor.email}</p>
              <span className="status">
                {route === "/pending" ? "PENDING" : "SUSPENDED"}
              </span>
            </div>
          )}
          <p className="sop-notice">
            Pendaftaran memerlukan persetujuan administrator PT Boga Rasa Tama.
          </p>
          <a className="text-link" href="?route=%2Flogin">
            Kembali ke Login
          </a>
        </AuthFrame>
      ) : (
        <Shell actor={actor} key={route}>
          {route === "/dashboard" ? (
            <Dashboard />
          ) : route === "/suhu-chiller" || route === "/suhu-freezer" ? (
            <MeasurementForm
              kind={route === "/suhu-chiller" ? "chiller" : "freezer"}
              actor={actor}
              initialSop={sop}
              initialMetadata={{ date: "2026-11-01", time: "09:15" }}
            />
          ) : route === "/laporan" ? (
            <Reports actor={actor} />
          ) : route === "/dashboard/users" ? (
            <UsersManagement />
          ) : (
            <Admin canManageUsers />
          )}
        </Shell>
      )}
    </UIProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
