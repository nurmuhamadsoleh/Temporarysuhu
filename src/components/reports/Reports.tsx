"use client";
import { measurementRefs } from "@/lib/devices";
import { signatureBlob } from "@/lib/client/canvas";
import { Tabs } from "antd";
import dynamic from "next/dynamic";
const ControlReports = dynamic(
  () => import("./ControlReports").then((m) => m.ControlReports),
  { loading: () => <p role="status">Memuat lembar kontrol…</p> },
);
import { useRef, useState } from "react";
import type SignatureCanvas from "react-signature-canvas";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { SignaturePad } from "@/components/signature/SignaturePad";
import { toast } from "sonner";
import { Download, FileText, Printer, ShieldCheck, Eye } from "lucide-react";
import {
  useData,
  api,
  Loading,
  ErrorBox,
  Empty,
  Status,
} from "@/components/ui";
import {
  displayDate,
  jakartaNow,
  temperature,
  type Measurement,
  type Actor,
} from "@/lib/domain";
type ReportRow = {
  id: string;
  createdAt: string;
  status: string;
  approver: string;
  approvedAt: string;
  revisionOf: string;
};
type Data = {
  records: Measurement[];
  reports: ReportRow[];
  certificateConfigured: boolean;
};
function LegacyReports({ actor }: { actor: Actor }) {
  const approvalPad = useRef<SignatureCanvas>(null);
  const [approvalId, setApprovalId] = useState("");
  const approve = async () => {
    if (!approvalPad.current || approvalPad.current.isEmpty()) {
      toast.error("Tanda tangan pemeriksa wajib diisi");
      return;
    }
    setBusy(true);
    try {
      const blob = await signatureBlob(approvalPad.current.getCanvas());
      const signature = await api<{ id: string }>("/api/signatures", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      await api(`/api/reports/${approvalId}/approve`, {
        method: "POST",
        body: JSON.stringify({ signatureId: signature.id }),
      });
      toast.success("Laporan disetujui dan pengukuran terkunci");
      setApprovalId("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [filters, setFilters] = useState({
      kind: "all",
      from: "",
      to: "",
      officer: "",
      status: "",
      q: "",
    }),
    [page, setPage] = useState(1),
    [sort, setSort] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [revision, setRevision] = useState("");
  const query = new URLSearchParams(filters).toString(),
    { data, error, loading, refresh } = useData<Data>(`/api/reports?${query}`);
  const update = (k: string, v: string) => {
    setFilters({ ...filters, [k]: v });
    setPage(1);
  };
  const exporting = async (format: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, filters, revisionOf: revision }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      if (format === "pdf") {
        const r = await res.json();
        setPreview(r.data.url);
        toast.success("Snapshot laporan dibuat");
        await refresh();
      } else {
        const url = URL.createObjectURL(await res.blob()),
          a = document.createElement("a");
        a.href = url;
        a.download = `temperature-report.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const records = sort ? data?.records.slice().reverse() : data?.records;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REPORTS & COMPLIANCE</span>
          <h1>Laporan monitoring</h1>
          <p>
            Dokumentasi suhu yang dapat ditelusuri untuk kebutuhan operasional
            dan audit.
          </p>
        </div>
        <span className="tag">
          <ShieldCheck size={15} />
          Snapshot & audit trail
        </span>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Filter laporan</h2>
            <p>Tentukan cakupan data sebelum membuat laporan.</p>
          </div>
          <button
            className="text-link"
            onClick={() => {
              setFilters({
                kind: "all",
                from: "",
                to: "",
                officer: "",
                status: "",
                q: "",
              });
              setPage(1);
            }}
          >
            Reset filter
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <label>
            Perangkat
            <select
              value={filters.kind}
              onChange={(e) => update("kind", e.target.value)}
            >
              <option value="all">Semua</option>
              <option value="chiller">Chiller</option>
              <option value="freezer">Freezer</option>
            </select>
          </label>
          <label>
            Dari tanggal
            <input
              type="date"
              value={filters.from}
              onChange={(e) => update("from", e.target.value)}
            />
          </label>
          <label>
            Sampai tanggal
            <input
              type="date"
              min={filters.from}
              value={filters.to}
              onChange={(e) => update("to", e.target.value)}
            />
          </label>
          <label>
            Petugas
            <input
              placeholder="Nama petugas"
              value={filters.officer}
              onChange={(e) => update("officer", e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">Semua status</option>
              {["NORMAL", "ALERT", "BELUM DIKONFIGURASI"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Pencarian
            <input
              placeholder="Cari data…"
              value={filters.q}
              onChange={(e) => update("q", e.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="panel mt-6">
        <div className="panel-title">
          <div>
            <h2>Data pengukuran</h2>
            <p>{data?.records.length || 0} pengukuran sesuai filter</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void exporting("csv")}
            >
              <Download size={15} />
              CSV
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void exporting("xlsx")}
            >
              Excel
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void exporting("pdf")}
            >
              <FileText size={16} />
              {busy ? "Memproses…" : "Buat & preview PDF"}
            </button>
          </div>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : !records?.length ? (
          <Empty />
        ) : (
          <>
            <div
              className="table-scroll"
              role="region"
              aria-label="Tabel data; geser horizontal untuk kolom lainnya"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>
                      <button onClick={() => setSort(!sort)}>
                        Tanggal / Jam ↕
                      </button>
                    </th>
                    <th>Perangkat</th>
                    <th>Pembacaan sensor</th>
                    <th>Petugas</th>
                    <th>Status</th>
                    <th>Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice((page - 1) * 10, page * 10).map((r) => (
                    <tr key={r.id}>
                      <td>
                        {displayDate(r.date)}
                        <small>{r.time} WIB</small>
                      </td>
                      <td className="capitalize">{r.kind}</td>
                      <td>
                        {r.values
                          .map(
                            (v, i) =>
                              measurementRefs(r)[i].number +
                              ": " +
                              temperature(v),
                          )
                          .join(" / ")}
                      </td>
                      <td>{r.officer}</td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td className="max-w-52 whitespace-pre-wrap">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>Halaman {page}</span>
              <button
                className="btn secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Sebelumnya
              </button>
              <button
                className="btn secondary"
                disabled={page * 10 >= records.length}
                onClick={() => setPage(page + 1)}
              >
                Berikutnya
              </button>
            </div>
          </>
        )}
      </section>
      {preview && (
        <section className="panel mt-6">
          <div className="panel-title">
            <h2>Preview laporan</h2>
            <div className="flex gap-3">
              <a className="btn secondary" href={preview} target="_blank">
                <Printer size={16} />
                Buka / print / download
              </a>
              <button className="text-link" onClick={() => setPreview("")}>
                Tutup
              </button>
            </div>
          </div>
          <iframe
            title="Preview PDF laporan"
            src={preview}
            className="pdf-preview"
          />
        </section>
      )}
      <section className="panel mt-6">
        <div className="panel-title">
          <div>
            <h2>Arsip & persetujuan laporan</h2>
            <p>
              Mode A: tanda tangan elektronik visual. Mode B: sertifikat digital
              pada PDF.
            </p>
          </div>
        </div>
        {!data?.certificateConfigured && (
          <div className="sop-notice mb-5">
            Mode B nonaktif: administrator perlu menyediakan sertifikat P12/PFX,
            password, dan OpenSSL pada server.
          </div>
        )}
        {revision && (
          <div className="sop-notice mb-4">
            Laporan berikutnya merupakan revisi dari {revision}.
            <button className="text-link" onClick={() => setRevision("")}>
              Batal revisi
            </button>
          </div>
        )}
        {!data?.reports.length ? (
          <Empty />
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Tabel data; geser horizontal untuk kolom lainnya"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Nomor laporan</th>
                  <th>Dibuat</th>
                  <th>Status</th>
                  <th>Pemeriksa</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">
                      {r.id}
                      {r.revisionOf && (
                        <small>Revisi dari {r.revisionOf}</small>
                      )}
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("id-ID", {
                        timeZone: "Asia/Jakarta",
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(r.createdAt))}
                    </td>
                    <td>
                      <Status value={r.status} />
                    </td>
                    <td>{r.approver || "Belum disetujui"}</td>
                    <td>
                      <div className="flex gap-3 flex-wrap">
                        <button
                          className="text-link"
                          onClick={() =>
                            setPreview(`/api/reports/${r.id}/download`)
                          }
                        >
                          <Eye size={14} />
                          Preview
                        </button>
                        <button
                          className="text-link"
                          onClick={() => {
                            setRevision(r.id);
                            toast.info(
                              "Atur filter lalu buat PDF untuk revisi baru",
                            );
                          }}
                        >
                          Revisi
                        </button>
                        {actor.role !== "PETUGAS" && r.status === "DRAFT" && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => setApprovalId(r.id)}
                          >
                            Approve
                          </button>
                        )}
                        {actor.role !== "PETUGAS" &&
                          r.status === "APPROVED" && (
                            <button
                              className="text-link"
                              disabled={!data.certificateConfigured || busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await api(`/api/reports/${r.id}/sign`, {
                                    method: "POST",
                                  });
                                  toast.success(
                                    "Tanda tangan kriptografis terverifikasi",
                                  );
                                  await refresh();
                                } catch (e) {
                                  toast.error((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Sign Mode B
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {approvalId && (
        <ResponsiveDialog
          title="Persetujuan & tanda tangan pemeriksa"
          busy={busy}
          onClose={() => setApprovalId("")}
        >
          <p>
            Anda menyetujui laporan sebagai {actor.name}. Pengukuran di dalam
            laporan akan terkunci. Tanda tangan ini merupakan tanda tangan
            elektronik visual (Mode A).
          </p>
          <div className="my-5">
            <SignaturePad padRef={approvalPad} />
          </div>
          <button
            className="text-link mb-5"
            onClick={() => approvalPad.current?.clear()}
            disabled={busy}
          >
            Bersihkan tanda tangan
          </button>
          <div className="flex gap-3">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setApprovalId("")}
            >
              Batal
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void approve()}
            >
              {busy ? "Memproses…" : "Setujui & kunci data"}
            </button>
          </div>
        </ResponsiveDialog>
      )}
    </>
  );
}

export function Reports({
  actor,
  initialDate = jakartaNow().date,
}: {
  actor: Actor;
  initialDate?: string;
}) {
  return (
    <Tabs
      defaultActiveKey="control"
      items={[
        {
          key: "control",
          label: "Lembar kontrol suhu",
          children: <ControlReports actor={actor} initialDate={initialDate} />,
        },
        {
          key: "legacy",
          label: "Rekap & export sebelumnya",
          children: <LegacyReports actor={actor} />,
        },
      ]}
    />
  );
}
