"use client";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Checkbox,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signature/SignaturePad";
import { api, useData, ErrorBox } from "@/components/ui";
import {
  config,
  jakartaNow,
  temperature,
  displayDate,
  type Actor,
  type Kind,
} from "@/lib/domain";
import {
  controlFilterSchema,
  reportConfigSchema,
  type ControlFilter,
  type ReportConfig,
  type TemperatureReport,
  type TemperatureVerification,
} from "@/lib/temperature-report/model";
import { pickerPopupAlign } from "@/config/design";
import { actionStatuses, actionStatusLabels } from "@/lib/temperature-policy";
import { ControlSheetPreview } from "./ControlSheetPreview";
type Filters = {
  kind: Kind;
  deviceNumber: number;
  month: Dayjs;
  from?: Dayjs;
  to?: Dayjs;
  coldStorage: string;
  officer: string;
};
type Loaded = {
  report: TemperatureReport;
  fresh?: boolean;
  verification?: TemperatureVerification | null;
  status?: string;
  certificateConfigured: boolean;
};
type Archive = {
  id: string;
  createdAt: string;
  status: string;
  filter: ControlFilter;
  revisionOf: string;
};
export function ControlReports({
  actor,
  initialDate,
}: {
  actor: Actor;
  initialDate: string;
}) {
  const [modal, modalContext] = Modal.useModal();
  const [form] = Form.useForm<Filters>(),
    [settingsForm] = Form.useForm(),
    [actionForm] = Form.useForm();
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pdf, setPdf] = useState(""),
    [settingsOpen, setSettingsOpen] = useState(false),
    [actionOpen, setActionOpen] = useState(false),
    [approveOpen, setApproveOpen] = useState(false),
    [revisionOf, setRevisionOf] = useState("");
  const artifact = useRef<{ id: string; url: string } | null>(null);
  const clearArtifact = () => {
    if (artifact.current) URL.revokeObjectURL(artifact.current.url);
    artifact.current = null;
    setPdf("");
  };
  useEffect(
    () => () => {
      if (artifact.current) URL.revokeObjectURL(artifact.current.url);
    },
    [],
  );
  const pad = useRef<SignatureCanvas>(null),
    request = useRef<{ payload: string; id: string } | null>(null),
    actionRequest = useRef<{ payload: string; id: string } | null>(null);
  const archive = useData<Archive[]>("/api/reports/control/archive"),
    settings = useData<{ settings: ReportConfig; version: string }>(
      "/api/reports/control/config",
    );
  const selectedKind = Form.useWatch("kind", form) || "chiller",
    report = loaded?.report,
    saved = !!report && report.id !== "PREVIEW",
    canVerify = actor.role !== "PETUGAS",
    canConfigure = ["ADMIN", "SUPER_ADMIN"].includes(actor.role);
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const parseFilter = (values: Filters) =>
    controlFilterSchema.parse({
      kind: values.kind,
      deviceNumber: values.deviceNumber,
      month: values.month.month() + 1,
      year: values.month.year(),
      ...(values.from ? { from: values.from.format("YYYY-MM-DD") } : {}),
      ...(values.to ? { to: values.to.format("YYYY-MM-DD") } : {}),
      coldStorage: values.coldStorage || "",
      officer: values.officer || "",
    });
  const preview = async (filter: ControlFilter) => {
    const params = new URLSearchParams(
      Object.entries(filter).map(([k, v]) => [k, String(v)]),
    );
    const data = await api<Loaded>(`/api/reports/control?${params}`);
    clearArtifact();
    setLoaded(data);
  };
  const loadSaved = async (id: string) => {
    const data = await api<Loaded>(`/api/reports/control/${id}`);
    clearArtifact();
    setLoaded(data);
    const f = data.report.filter;
    form.setFieldsValue({
      ...f,
      month: dayjs(`${f.year}-${String(f.month).padStart(2, "0")}-01`),
      from: f.from ? dayjs(f.from) : undefined,
      to: f.to ? dayjs(f.to) : undefined,
    });
  };
  const refreshCurrent = async () => {
    if (report) await (saved ? loadSaved(report.id) : preview(report.filter));
    await archive.refresh();
  };
  const snapshot = async () => {
    if (!report) throw new Error("Tampilkan laporan terlebih dahulu");
    if (saved) return report.id;
    const payload = JSON.stringify({
      filter: report.filter,
      ...(revisionOf ? { revisionOf } : {}),
    });
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    const result = await api<{ id: string }>("/api/reports/control", {
      method: "POST",
      headers: { "Idempotency-Key": request.current!.id },
      body: payload,
    });
    await loadSaved(result.id);
    await archive.refresh();
    return result.id;
  };
  const pdfAction = (action: "preview" | "download" | "print") => {
    const printWindow =
      action === "print" ? window.open("about:blank", "_blank") : null;
    if (printWindow) printWindow.opener = null;
    void guard(async () => {
      try {
        const id = await snapshot();
        if (artifact.current?.id !== id) {
          const response = await fetch(`/api/reports/${id}/download`, {
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(
              (await response.json()).message || "PDF belum dapat dibuat",
            );
          const blob = await response.blob();
          if (!blob.type.includes("application/pdf"))
            throw new Error("Respons PDF tidak valid");
          if (artifact.current) URL.revokeObjectURL(artifact.current.url);
          artifact.current = { id, url: URL.createObjectURL(blob) };
        }
        const url = artifact.current.url;
        if (action === "preview") setPdf(url);
        else if (action === "print") {
          if (!printWindow)
            throw new Error(
              "Izinkan tab baru untuk membuka PDF dan mencetaknya",
            );
          printWindow.location.href = url;
        } else {
          const a = document.createElement("a");
          a.href = url;
          a.download = "kontrol-suhu.pdf";
          a.click();
        }
      } catch (e) {
        printWindow?.close();
        throw e;
      }
    });
  };
  return (
    <div className="control-reports">
      {modalContext}
      <div className="page-heading">
        <div>
          <span className="eyebrow">QC / HACCP RECORD SHEET</span>
          <h1>Laporan kontrol suhu</h1>
          <p>
            Lembar grid dari database dengan skala Celsius kontinu dan identitas
            petugas.
          </p>
        </div>
        {canConfigure && (
          <Button
            onClick={() => {
              if (settings.data) {
                settingsForm.setFieldsValue({
                  ...settings.data.settings,
                  connectAcrossGaps:
                    settings.data.settings.connectAcrossGaps ?? false,
                  schedule: settings.data.settings.schedule.join(", "),
                });
                setSettingsOpen(true);
              }
            }}
            disabled={!settings.data}
          >
            Konfigurasi laporan
          </Button>
        )}
      </div>
      {settings.error && (
        <ErrorBox message={settings.error} retry={settings.refresh} />
      )}
      <Card title="Perangkat dan periode" className="mb-6">
        <Form
          className="control-report-form"
          form={form}
          layout="vertical"
          initialValues={{
            kind: "chiller",
            deviceNumber: 1,
            month: dayjs(initialDate),
            coldStorage: "",
            officer: "",
          }}
          onFinish={(values) =>
            void guard(async () => {
              setRevisionOf("");
              request.current = null;
              await preview(parseFilter(values));
            })
          }
        >
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            <Form.Item
              name="kind"
              label="Jenis laporan"
              rules={[{ required: true }]}
            >
              <Select
                onChange={() => form.setFieldValue("deviceNumber", 1)}
                options={[
                  { value: "chiller", label: "Kontrol Suhu Chiller" },
                  { value: "freezer", label: "Kontrol Suhu Freezer" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="deviceNumber"
              label="Nomor perangkat"
              rules={[{ required: true }]}
            >
              <Select
                options={Array.from(
                  { length: config[selectedKind as Kind].count },
                  (_, i) => ({
                    value: i + 1,
                    label: `${config[selectedKind as Kind].label} ${i + 1}`,
                  }),
                )}
              />
            </Form.Item>
            <Form.Item
              name="month"
              label="Bulan / Tahun"
              rules={[{ required: true }]}
            >
              <DatePicker
                popupAlign={pickerPopupAlign}
                picker="month"
                format="MMMM YYYY"
                allowClear={false}
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item name="from" label="Tanggal mulai (opsional)">
              <DatePicker
                popupAlign={pickerPopupAlign}
                format="DD/MM/YYYY"
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item name="to" label="Tanggal akhir (opsional)">
              <DatePicker
                popupAlign={pickerPopupAlign}
                format="DD/MM/YYYY"
                style={{ width: "100%" }}
              />
            </Form.Item>
            <Form.Item name="coldStorage" label="No. Cold Storage">
              <Input
                maxLength={80}
                placeholder="Belum dikonfigurasi; isi identitas sebenarnya"
              />
            </Form.Item>
            <Form.Item name="officer" label="Nama petugas (filter)">
              <Input maxLength={150} placeholder="Semua petugas" />
            </Form.Item>
          </div>
          <Button htmlType="submit" type="primary" loading={busy}>
            Tampilkan Laporan
          </Button>
        </Form>
      </Card>
      {error && <ErrorBox message={error} />}
      {archive.error ? (
        <ErrorBox message={archive.error} retry={archive.refresh} />
      ) : (
        <Form layout="vertical">
          <Form.Item label="Buka snapshot laporan tersimpan">
            <Select
              allowClear
              aria-label="Buka snapshot laporan tersimpan"
              placeholder="Pilih laporan kontrol"
              value={saved ? report!.id : undefined}
              onChange={(id) => {
                if (id) void guard(() => loadSaved(id));
                else {
                  setLoaded(null);
                  setRevisionOf("");
                  request.current = null;
                }
              }}
              options={archive.data?.map((r) => ({
                value: r.id,
                label: `${r.filter.kind} ${r.filter.deviceNumber} · ${r.filter.month}/${r.filter.year} · ${r.status} · ${r.id.slice(0, 8)}`,
              }))}
            />
          </Form.Item>
        </Form>
      )}
      {loaded && report && (
        <Spin spinning={busy}>
          <Card
            title={`${config[report.device.type].label} ${report.device.number} · ${report.readings.length} pembacaan`}
          >
            <Space wrap className="mb-4">
              <Tag>{saved ? loaded.status : "PREVIEW - BELUM DISIMPAN"}</Tag>
              <Tag
                color={
                  loaded.verification?.status === "VERIFIED" && loaded.fresh
                    ? "green"
                    : "gold"
                }
              >
                {loaded.verification?.status || "BELUM DIVERIFIKASI"}
              </Tag>
              <span className="caption">
                No. Cold Storage: {report.device.coldStorage}
              </span>
            </Space>
            {(loaded.fresh === false ||
              loaded.verification?.status === "INVALIDATED") && (
              <p role="alert" className="sop-notice">
                Sumber laporan berubah. Verifikasi lama tidak berlaku; buat
                revisi baru. PDF bersertifikat yang sudah tersimpan tetap
                merupakan arsip asli.
              </p>
            )}
            {revisionOf && (
              <p className="sop-notice">Revisi dari {revisionOf}</p>
            )}
            <p className="caption mb-3">
              {report.corrections.length} tindakan korektif sesuai perangkat dan
              periode.
            </p>
            <Space wrap className="mb-5">
              <Button
                disabled={busy}
                onClick={() =>
                  void guard(async () => {
                    setRevisionOf(saved ? report.id : revisionOf);
                    request.current = null;
                    await preview(report.filter);
                    await archive.refresh();
                  })
                }
              >
                Buat ulang dari data terbaru
              </Button>
              <Button onClick={() => pdfAction("preview")} disabled={busy}>
                Preview PDF
              </Button>
              <Button onClick={() => pdfAction("download")} disabled={busy}>
                Download PDF
              </Button>
              <Tooltip title="Buka PDF pada tab baru lalu gunakan Print pada pembaca PDF">
                <Button onClick={() => pdfAction("print")} disabled={busy}>
                  Print
                </Button>
              </Tooltip>
              <Button
                onClick={() => {
                  actionForm.resetFields();
                  const now = jakartaNow();
                  actionForm.setFieldsValue({
                    date: dayjs(now.date),
                    time: now.time,
                  });
                  setActionOpen(true);
                }}
                disabled={!report.readings.length || busy}
              >
                Catat koreksi / tindakan
              </Button>
              {canVerify && (
                <Button
                  type="primary"
                  disabled={
                    !saved ||
                    loaded.status !== "DRAFT" ||
                    loaded.fresh === false ||
                    busy
                  }
                  onClick={() => setApproveOpen(true)}
                >
                  Verifikasi Laporan
                </Button>
              )}
              {saved && (
                <Button
                  onClick={() =>
                    void guard(async () => {
                      setRevisionOf(report.id);
                      request.current = null;
                      await preview(report.filter);
                    })
                  }
                >
                  Buat revisi baru
                </Button>
              )}
              {canVerify && saved && (
                <Tooltip
                  title={
                    loaded.certificateConfigured
                      ? "Signing sertifikat di backend"
                      : "Mode B nonaktif: sertifikat resmi belum dikonfigurasi"
                  }
                >
                  <Button
                    disabled={
                      !loaded.certificateConfigured ||
                      loaded.status !== "APPROVED" ||
                      !loaded.fresh ||
                      loaded.verification?.status !== "VERIFIED" ||
                      busy
                    }
                    onClick={() =>
                      void guard(async () => {
                        await api(`/api/reports/${report.id}/sign`, {
                          method: "POST",
                        });
                        toast.success(
                          "PDF ditandatangani dan diverifikasi secara kriptografis",
                        );
                        await refreshCurrent();
                      })
                    }
                  >
                    Sign PDF (sertifikat)
                  </Button>
                </Tooltip>
              )}
            </Space>
            {loaded.status === "SIGNED" ? (
              <div className="my-4">
                <p>
                  PDF bersertifikat tetap menggunakan dokumen asli. Buat revisi
                  untuk menerapkan format laporan baru.
                </p>
                <Button onClick={() => pdfAction("preview")} disabled={busy}>
                  Lihat PDF asli
                </Button>
              </div>
            ) : (
              <ControlSheetPreview
                key={report.id + report.sourceHash}
                report={report}
                verification={loaded.verification}
              />
            )}
            <h3 className="mt-6 mb-3">Koreksi dan tindakan korektif</h3>
            <Table
              rowKey="id"
              size="small"
              scroll={{ x: 900 }}
              dataSource={report.corrections}
              locale={{
                emptyText: "Tidak ada tindakan korektif pada periode ini.",
              }}
              pagination={{ pageSize: 5 }}
              columns={[
                {
                  title: "Tanggal / Jam",
                  render: (_, a) => `${displayDate(a.date)} ${a.time} WIB`,
                },
                {
                  title: "Koreksi / tindakan",
                  dataIndex: "description",
                  render: (v) => (
                    <span className="whitespace-pre-wrap break-words">{v}</span>
                  ),
                  width: 280,
                },
                { title: "Dilakukan oleh", dataIndex: "performedByName" },
                {
                  title: "Status Tindakan",
                  render: (_, a) =>
                    a.actionStatus
                      ? actionStatusLabels[a.actionStatus]
                      : "Belum dicatat",
                },
                { title: "Verifikasi", dataIndex: "verificationStatus" },
                {
                  title: "Pemeriksa",
                  render: (_, a) =>
                    a.verificationStatus === "VERIFIED" ? a.verifiedByName : "",
                },
                { title: "Diverifikasi oleh", dataIndex: "verifiedByName" },
                {
                  title: "Aksi",
                  render: (_, a) =>
                    canVerify && a.verificationStatus === "PENDING" ? (
                      <Button
                        onClick={() =>
                          modal.confirm({
                            title: "Verifikasi tindakan yang tercatat?",
                            content: a.description,
                            onOk: () =>
                              guard(async () => {
                                await api(
                                  `/api/reports/control/corrections/${a.id}/verify`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      version: a.updatedAt,
                                    }),
                                  },
                                );
                                await refreshCurrent();
                              }),
                          })
                        }
                      >
                        Verifikasi
                      </Button>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Card>
        </Spin>
      )}
      <Modal
        title="Preview PDF lembar kontrol"
        open={!!pdf}
        onCancel={() => setPdf("")}
        width={1100}
        footer={
          <Space wrap>
            <a
              className="btn secondary"
              href={pdf}
              target="_blank"
              rel="noreferrer"
            >
              Buka / Print
            </a>
            <a className="btn primary" href={pdf} download="kontrol-suhu.pdf">
              Download PDF
            </a>
          </Space>
        }
      >
        <iframe
          className="pdf-preview"
          title="PDF lembar kontrol suhu"
          src={pdf || undefined}
        />
      </Modal>
      <Modal
        title="Catat tindakan yang benar-benar dilakukan"
        open={actionOpen}
        onCancel={() => {
          if (!busy) setActionOpen(false);
        }}
        footer={null}
      >
        <Form
          className="control-report-form"
          form={actionForm}
          initialValues={{ actionStatus: "PENDING" }}
          layout="vertical"
          onFinish={(values) =>
            void guard(async () => {
              if (!report) return;
              const payload = JSON.stringify({
                recordId: values.recordId,
                deviceType: report.device.type,
                deviceNumber: report.device.number,
                date: values.date.format("YYYY-MM-DD"),
                time: values.time,
                description: values.description,
                performedByName: values.performedByName,
                actionStatus: values.actionStatus,
              });
              if (actionRequest.current?.payload !== payload)
                actionRequest.current = { payload, id: crypto.randomUUID() };
              await api("/api/reports/control/corrections", {
                method: "POST",
                headers: { "Idempotency-Key": actionRequest.current!.id },
                body: payload,
              });
              setActionOpen(false);
              actionRequest.current = null;
              toast.success("Tindakan tercatat; menunggu verifikasi");
              setRevisionOf(saved ? report.id : revisionOf);
              request.current = null;
              await preview(report.filter);
              await archive.refresh();
            })
          }
        >
          <Form.Item
            name="recordId"
            label="Pengukuran sumber"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={report?.readings.map((r) => ({
                value: r.recordId,
                label: `${r.date} ${r.time} · ${temperature(r.temperatureCelsius)} · ${r.operatorName}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="date"
            label="Tanggal tindakan"
            rules={[{ required: true }]}
          >
            <DatePicker
              popupAlign={pickerPopupAlign}
              format="DD/MM/YYYY"
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="time"
            label="Jam tindakan (HH:mm WIB)"
            rules={[
              { required: true },
              {
                pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
                message: "Gunakan HH:mm",
              },
            ]}
          >
            <Input placeholder="HH:mm" />
          </Form.Item>
          <Form.Item
            name="description"
            label="Keterangan / Tindakan Korektif"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} maxLength={2000} />
          </Form.Item>
          <Form.Item name="performedByName" label="Dilakukan Oleh">
            <Input
              maxLength={150}
              placeholder="Masukkan nama petugas yang melakukan tindakan."
            />
          </Form.Item>
          <Form.Item
            name="actionStatus"
            label="Status Tindakan"
            rules={[{ required: true }]}
          >
            <Select
              options={actionStatuses.map((value) => ({
                value,
                label: actionStatusLabels[value],
              }))}
            />
          </Form.Item>
          <p className="caption muted mb-3">
            Pencatat: {actor.name}. Status Selesai tidak berarti sudah
            diverifikasi Supervisor.
          </p>
          <Button type="primary" htmlType="submit" loading={busy}>
            Simpan catatan tindakan
          </Button>
        </Form>
      </Modal>
      <Modal
        title="Verifikasi supervisor"
        open={approveOpen}
        onCancel={() => {
          if (!busy) setApproveOpen(false);
        }}
        footer={null}
      >
        <p className="mb-4">
          Saya, {actor.name}, memverifikasi snapshot laporan ini. Tanda tangan
          berikut adalah pengesahan visual.
        </p>
        <SignaturePad padRef={pad} />
        <Space wrap className="mt-4">
          <Button onClick={() => pad.current?.clear()}>Bersihkan</Button>
          <Button
            type="primary"
            loading={busy}
            onClick={() =>
              void guard(async () => {
                if (!saved || !pad.current || pad.current.isEmpty())
                  throw new Error(
                    "Snapshot dan tanda tangan pemeriksa wajib tersedia",
                  );
                const blob = await (
                  await fetch(pad.current.toDataURL("image/png"))
                ).blob();
                const signature = await api<{ id: string }>("/api/signatures", {
                  method: "POST",
                  headers: { "Content-Type": "image/png" },
                  body: blob,
                });
                await api(`/api/reports/${report!.id}/approve`, {
                  method: "POST",
                  body: JSON.stringify({ signatureId: signature.id }),
                });
                setApproveOpen(false);
                await refreshCurrent();
                toast.success("Laporan terverifikasi");
              })
            }
          >
            Verifikasi dan kunci snapshot
          </Button>
        </Space>
      </Modal>
      <Drawer
        title="Konfigurasi lembar kontrol"
        open={settingsOpen}
        onClose={() => {
          if (!busy) setSettingsOpen(false);
        }}
        size="min(580px, calc(100vw - 16px))"
      >
        <Form
          className="control-report-form"
          form={settingsForm}
          layout="vertical"
          onFinish={(values) =>
            void guard(async () => {
              const next = reportConfigSchema.parse({
                ...values,
                operatorStyle: "name",
                schedule: String(values.schedule)
                  .split(",")
                  .map((v) => v.trim()),
              });
              await api("/api/reports/control/config", {
                method: "PATCH",
                body: JSON.stringify({
                  settings: next,
                  version: settings.data!.version,
                }),
              });
              setSettingsOpen(false);
              await settings.refresh();
              await refreshCurrent();
              toast.success("Konfigurasi laporan tersimpan dan diaudit");
            })
          }
        >
          <Form.Item
            name="schedule"
            label="Urutan jam WIB, pisahkan dengan koma"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <p className="caption muted mb-4">
            Contoh siklus 07:00, 11:00, 15:00, 19:00, 23:00, 03:00. Tanggal
            kalender sumber tidak digeser.
          </p>
          <Form.Item name="paper" label="Ukuran kertas">
            <Select
              options={[
                { value: "A4", label: "A4 Landscape" },
                { value: "A3", label: "A3 Landscape" },
              ]}
            />
          </Form.Item>
          <Form.Item name="daysPerPage" label="Maksimum tanggal per halaman">
            <Select
              options={Array.from({ length: 10 }, (_, i) => ({
                value: i + 1,
                label: String(i + 1),
              }))}
            />
          </Form.Item>
          <p className="caption muted mb-4">
            Halaman otomatis dibagi lagi jika kolom terlalu sempit, termasuk jam
            aktual di luar jadwal.
          </p>
          <Form.Item name="connectAcrossGaps" valuePropName="checked">
            <Checkbox>
              Hubungkan pembacaan valid melewati slot kosong (default: garis
              terputus)
            </Checkbox>
          </Form.Item>
          <p className="caption mb-4">
            Nama lengkap petugas selalu ditampilkan. Lebar kolom dan halaman
            menyesuaikan agar nama tetap terbaca.
          </p>
          <Form.Item
            name="correctionSopText"
            label="Teks SOP tindakan korektif resmi"
          >
            <Input.TextArea rows={7} maxLength={2000} />
          </Form.Item>
          <Form.Item name="correctionSopApproved" valuePropName="checked">
            <Checkbox>
              Saya mengonfirmasi teks ini adalah SOP perusahaan yang telah
              disahkan.
            </Checkbox>
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={busy}>
            Simpan konfigurasi
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
