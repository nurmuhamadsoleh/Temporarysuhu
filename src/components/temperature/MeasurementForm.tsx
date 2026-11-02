"use client";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type SignatureCanvas from "react-signature-canvas";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { SignaturePad } from "@/components/signature/SignaturePad";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfigProvider, DatePicker, TimePicker } from "antd";
import idID from "antd/locale/id_ID";
import dayjs from "dayjs";
import "dayjs/locale/id";
import { TemperatureVerticalSlider } from "./TemperatureVerticalSlider";
import {
  Save,
  RotateCcw,
  PenLine,
  Eye,
  History,
  CalendarDays,
  Clock3,
} from "lucide-react";
import {
  config,
  normalize,
  temperatureValueSchema,
  dateSchema,
  timeSchema,
  type Sop,
  jakartaNow,
  displayDate,
  temperature,
  type Actor,
  type Kind,
  type Measurement,
} from "@/lib/domain";
import {
  api,
  useData,
  Loading,
  ErrorBox,
  Empty,
  Status,
} from "@/components/ui";
import {
  DeviceCorrectionFields,
  type MeasurementFields as Fields,
} from "./DeviceCorrectionFields";
import {
  DEFAULT_TEMPERATURE_POLICY,
  emptyDeviceInput,
  validateDeviceInputs,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
export function MeasurementForm({
  kind,
  actor,
  initialSop,
  initialMetadata,
}: {
  kind: Kind;
  actor: Actor;
  initialSop: Sop;
  initialMetadata: { date: string; time: string };
}) {
  const router = useRouter();
  const sopData = useData<TemperaturePolicy>("/api/temperatures/policy");
  const policy = sopData.data ?? {
    ...DEFAULT_TEMPERATURE_POLICY,
    freezer: initialSop.freezer
      ? { ...initialSop.freezer, warningMax: null }
      : null,
  };
  const cfg = config[kind],
    canvas = useRef<SignatureCanvas>(null),
    pending = useRef<{
      content: string;
      signatureId: string;
      key: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [editing, setEditing] = useState<Measurement | null>(null),
    [detail, setDetail] = useState<Measurement | null>(null),
    [search, setSearch] = useState(""),
    [date, setDate] = useState(""),
    [page, setPage] = useState(1);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<Fields>({
    defaultValues: {
      ...initialMetadata,
      values: Array(cfg.count).fill(null),
      notes: "",
      devices: Array.from({ length: cfg.count }, emptyDeviceInput),
    },
  });
  const { data, error, loading, refresh } = useData<Measurement[]>(
    `/api/temperatures/${kind}?q=${encodeURIComponent(search)}&from=${date}&to=${date}`,
  );
  const values = useWatch({ control, name: "values" });
  const canWrite = actor.role !== "SUPERVISOR";
  const resetForm = () => {
    reset({
      ...jakartaNow(),
      values: Array(cfg.count).fill(null),
      notes: "",
      devices: Array.from({ length: cfg.count }, emptyDeviceInput),
    });
    canvas.current?.clear();
    setPreview("");
    setEditing(null);
    pending.current = null;
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    void handleSubmit(async (fields) => {
      setBusy(true);
      try {
        let signatureId = editing?.signatureId;
        const numeric = fields.values.map((v) =>
          v === null ? null : normalize(v),
        );
        if (
          numeric.some(
            (v) =>
              v !== null && !temperatureValueSchema(kind).safeParse(v).success,
          )
        )
          throw new Error(
            "Konfirmasikan seluruh suhu dengan presisi 0,1°C dalam rentang yang diizinkan",
          );
        if (!sopData.data)
          throw new Error("Kebijakan suhu belum berhasil dimuat. Coba lagi.");
        const validation = validateDeviceInputs(
          kind,
          numeric,
          fields.devices,
          policy,
        );
        if (validation.length)
          throw new Error(
            validation
              .map((e) => `${cfg.label} ${e.deviceNumber}: ${e.message}`)
              .join("; "),
          );
        if (!editing) {
          if (!canvas.current || canvas.current.isEmpty())
            throw new Error("Tanda tangan petugas wajib diisi");
          const image = canvas.current.toDataURL("image/png"),
            content = JSON.stringify({ ...fields, image });
          if (pending.current && pending.current.content !== content)
            throw new Error(
              "Request sebelumnya belum dikonfirmasi. Kembalikan isian semula untuk retry, atau periksa riwayat sebelum mereset form.",
            );
          if (!pending.current) {
            const blob = await (await fetch(image)).blob();
            const signature = await api<{ id: string }>("/api/signatures", {
              method: "POST",
              headers: { "Content-Type": "image/png" },
              body: blob,
            });
            pending.current = {
              content,
              signatureId: signature.id,
              key: crypto.randomUUID(),
            };
          }
          signatureId = pending.current.signatureId;
        }
        await api(
          `/api/temperatures/${kind}${editing ? `/${editing.id}` : ""}`,
          {
            method: editing ? "PATCH" : "POST",
            headers: editing ? {} : { "Idempotency-Key": pending.current!.key },
            body: JSON.stringify({
              date: fields.date,
              time: fields.time,
              values: numeric,
              devices: fields.devices,
              policyVersion: policy.version,
              notes: fields.notes,
              signatureId,
              ...(editing ? { version: editing.updatedAt } : {}),
            }),
          },
        );
        toast.success(
          editing ? "Perubahan tersimpan" : "Data tersimpan di Google Sheets",
        );
        resetForm();
        window.dispatchEvent(new Event("tempcontrol:measurements-updated"));
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    })(event);
  };
  const edit = (r: Measurement) => {
    setEditing(r);
    pending.current = null;
    reset({
      date: r.date,
      time: r.time,
      values: r.values.map((v) => (v === null ? null : normalize(v))),
      devices:
        r.deviceStates?.map((d) => ({
          missingReason: d.missingReason,
          correctiveAction: d.correctiveAction,
          performedBy: d.performedBy,
          actionStatus: d.actionStatus,
        })) ?? Array.from({ length: cfg.count }, emptyDeviceInput),
      notes: r.notes,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const total = data?.length || 0,
    visible = data?.slice((page - 1) * 10, page * 10) || [];
  return (
    <ConfigProvider
      locale={idID}
      theme={{
        token: {
          colorPrimary: kind === "chiller" ? "#0891b2" : "#6366f1",
        },
        components: {
          Slider: {
            railSize: 8,
            handleSize: 22,
            handleSizeHover: 24,
            trackBg: kind === "chiller" ? "#22b8cf" : "#818cf8",
            trackHoverBg: kind === "chiller" ? "#0891b2" : "#6366f1",
          },
        },
      }}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">PENCATATAN SUHU</span>
          <h1>Monitoring suhu {cfg.label.toLowerCase()}</h1>
          <p>
            Catat pengukuran {cfg.count} unit {cfg.label.toLowerCase()} dengan
            dokumentasi yang lengkap.
          </p>
        </div>
        <a className="btn secondary" href="#history">
          <History size={18} />
          Lihat riwayat
        </a>
      </div>
      {canWrite && (
        <form onSubmit={submit} className="panel form-panel temperature-form">
          <div className="panel-title">
            <div>
              <h2>{editing ? "Edit pengukuran" : "Pengukuran baru"}</h2>
              <p>
                Geser slider untuk mengonfirmasi suhu. Data disimpan hanya saat
                Simpan Data ditekan.
              </p>
            </div>
            <span className={`tag ${kind === "chiller" ? "cyan" : "indigo"}`}>
              {cfg.count} unit {cfg.label}
            </span>
          </div>
          <fieldset disabled={busy}>
            <div className="grid gap-5 md:grid-cols-3">
              <label>
                <span className="flex gap-2 items-center">
                  <CalendarDays size={15} />
                  Tanggal pengukuran
                </span>
                <Controller
                  name="date"
                  control={control}
                  rules={{
                    validate: (v) =>
                      dateSchema.safeParse(v).success || "Tanggal tidak valid",
                  }}
                  render={({ field }) => (
                    <DatePicker
                      popupAlign={{
                        offset: [0, 0],
                        overflow: {
                          adjustX: true,
                          adjustY: true,
                          shiftX: 8,
                          shiftY: 8,
                        },
                      }}
                      id="measurement-date"
                      aria-label="Tanggal pengukuran"
                      value={
                        field.value
                          ? dayjs(`${field.value}T00:00:00`).locale("id")
                          : null
                      }
                      onChange={(v) =>
                        field.onChange(v ? v.format("YYYY-MM-DD") : "")
                      }
                      onBlur={field.onBlur}
                      format="DD/MM/YYYY"
                      disabled={busy}
                      allowClear={false}
                      inputReadOnly
                      style={{ width: "100%" }}
                    />
                  )}
                />
                {errors.date && (
                  <small className="field-error">Tanggal wajib diisi</small>
                )}
              </label>
              <label>
                <span className="flex gap-2 items-center">
                  <Clock3 size={15} />
                  Jam pengukuran (WIB)
                </span>
                <Controller
                  name="time"
                  control={control}
                  rules={{
                    validate: (v) =>
                      timeSchema.safeParse(v).success || "Jam tidak valid",
                  }}
                  render={({ field }) => (
                    <TimePicker
                      popupAlign={{
                        offset: [0, 0],
                        overflow: {
                          adjustX: true,
                          adjustY: true,
                          shiftX: 8,
                          shiftY: 8,
                        },
                      }}
                      id="measurement-time"
                      aria-label="Jam pengukuran (WIB)"
                      value={
                        field.value
                          ? dayjs(`2000-01-01T${field.value}:00`)
                          : null
                      }
                      onChange={(v) =>
                        field.onChange(v ? v.format("HH:mm") : "")
                      }
                      onBlur={field.onBlur}
                      format="HH:mm"
                      use12Hours={false}
                      disabled={busy}
                      allowClear={false}
                      inputReadOnly
                      needConfirm
                      style={{ width: "100%" }}
                    />
                  )}
                />
                {errors.time && (
                  <small className="field-error">Jam wajib diisi</small>
                )}
              </label>
              <label>
                Nama petugas
                <input value={editing?.officer || actor.name} readOnly />
                <small className="muted">
                  Identitas diverifikasi dari session.
                </small>
              </label>
            </div>
            <div className="section-divider" />
            <div className="temperature-section-heading">
              <h3>Pembacaan suhu</h3>
              <span>
                {values.filter((v) => v !== null).length}/{cfg.count}{" "}
                terkonfirmasi
              </span>
            </div>
            {sopData.error && (
              <div className="sop-notice">
                Batas SOP belum dapat diperbarui. Status di server tetap
                divalidasi saat simpan.
                <button
                  type="button"
                  className="text-link"
                  onClick={() => void sopData.refresh()}
                >
                  Coba lagi
                </button>
              </div>
            )}
            <div
              className={`grid temperature-vertical-grid ${kind === "freezer" ? "temperature-grid-freezer" : "temperature-grid-chiller"}`}
            >
              {Array.from({ length: cfg.count }, (_, i) => (
                <Controller
                  key={i}
                  name={`values.${i}`}
                  control={control}
                  rules={{
                    validate: (v) =>
                      v === null ||
                      temperatureValueSchema(kind).safeParse(v).success ||
                      "Geser atau konfirmasikan suhu",
                  }}
                  render={({ field, fieldState }) => (
                    <TemperatureVerticalSlider
                      type={kind}
                      label={`Suhu ${cfg.label} ${i + 1}`}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={busy}
                      error={fieldState.error?.message}
                      policy={policy}
                      sop={policy[kind]}
                    >
                      <DeviceCorrectionFields
                        index={i}
                        value={field.value}
                        type={kind}
                        policy={policy}
                        control={control}
                        disabled={busy}
                      />
                    </TemperatureVerticalSlider>
                  )}
                />
              ))}
            </div>
            <div className="section-divider" />
            <div className="grid gap-6 lg:grid-cols-2">
              <label>
                Keterangan <span className="muted font-normal">(opsional)</span>
                <textarea
                  rows={6}
                  maxLength={2000}
                  placeholder="Catatan kondisi perangkat atau tindakan yang dilakukan…"
                  {...register("notes")}
                />
                <small className="muted">Maksimum 2.000 karakter.</small>
              </label>
              <div>
                <label className="mb-2">
                  <span className="flex gap-2 items-center">
                    <PenLine size={16} />
                    Tanda tangan petugas
                  </span>
                </label>
                {editing ? (
                  <>
                    <img
                      className="signature-preview"
                      src={`/api/signatures/${editing.signatureId}`}
                      alt="Tanda tangan asli petugas"
                    />
                    <small className="muted">
                      Perubahan dicatat pada audit trail. Tanda tangan asli
                      dipertahankan.
                    </small>
                  </>
                ) : (
                  <>
                    <SignaturePad padRef={canvas} />
                    <div className="flex gap-4 mt-2">
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          canvas.current?.clear();
                          setPreview("");
                        }}
                      >
                        <RotateCcw size={14} />
                        Bersihkan
                      </button>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          if (!canvas.current?.isEmpty())
                            setPreview(canvas.current!.toDataURL());
                        }}
                      >
                        <Eye size={14} />
                        Preview
                      </button>
                    </div>
                    {preview && (
                      <img
                        src={preview}
                        alt="Preview tanda tangan"
                        className="signature-preview"
                      />
                    )}
                  </>
                )}
                <p className="muted mt-2 text-xs">
                  Tanda tangan elektronik visual, berbeda dari sertifikat
                  digital PDF.
                </p>
              </div>
            </div>
            <div className="form-footer">
              <span className="muted text-xs">
                Tanggal dan jam menggunakan zona waktu Asia/Jakarta.
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={resetForm}
                >
                  <RotateCcw size={16} />
                  {editing ? "Batal edit" : "Reset form"}
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !sopData.data}
                >
                  <Save size={17} />
                  {busy
                    ? "Menyimpan…"
                    : editing
                      ? "Simpan perubahan"
                      : "Simpan data"}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
      <section id="history" className="panel mt-6">
        <div className="panel-title">
          <div>
            <h2>Riwayat pengukuran</h2>
            <p>{total} pengukuran ditemukan</p>
          </div>
          <button className="btn secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="filter-bar border-0 p-0 mb-5">
          <input
            aria-label="Cari petugas atau keterangan"
            placeholder="Cari petugas, tanggal, keterangan…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <input
            aria-label="Filter tanggal"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
          <button
            className="text-link"
            onClick={() => {
              setSearch("");
              setDate("");
              setPage(1);
            }}
          >
            Reset filter
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : !total ? (
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
                    <th>Tanggal / Jam</th>
                    {Array.from({ length: cfg.count }, (_, i) => (
                      <th key={i}>
                        {cfg.label} {i + 1}
                      </th>
                    ))}
                    <th>Petugas</th>
                    <th>Tanda tangan</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{displayDate(r.date)}</strong>
                        <small>{r.time} WIB</small>
                      </td>
                      {r.values.map((v, i) => (
                        <td key={i}>
                          <span>{temperature(v)}</span>
                          {r.deviceStates?.[i] && (
                            <div className="mt-1">
                              <Status
                                value={r.deviceStates[i].temperatureStatus}
                              />
                            </div>
                          )}
                        </td>
                      ))}
                      <td>{r.officer}</td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => setDetail(r)}
                        >
                          Lihat
                        </button>
                      </td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td>
                        <div className="flex gap-3">
                          <button
                            className="text-link"
                            onClick={() => setDetail(r)}
                          >
                            Detail
                          </button>
                          {canWrite &&
                            (["ADMIN", "SUPER_ADMIN"].includes(actor.role) ||
                              r.createdBy === actor.id) && (
                              <button
                                className="text-link"
                                onClick={() => edit(r)}
                              >
                                Edit
                              </button>
                            )}
                          {["ADMIN", "SUPER_ADMIN"].includes(actor.role) && (
                            <button
                              className="text-red-600 text-xs"
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    "Hapus pengukuran ini? Penghapusan akan dicatat pada audit log.",
                                  )
                                )
                                  return;
                                try {
                                  await api(
                                    `/api/temperatures/${kind}/${r.id}`,
                                    { method: "DELETE" },
                                  );
                                  toast.success("Data dihapus");
                                  window.dispatchEvent(
                                    new Event(
                                      "tempcontrol:measurements-updated",
                                    ),
                                  );
                                  router.refresh();
                                } catch (e) {
                                  toast.error((e as Error).message);
                                }
                              }}
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Halaman {page} dari {Math.max(1, Math.ceil(total / 10))}
              </span>
              <button
                className="btn secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Sebelumnya
              </button>
              <button
                className="btn secondary"
                disabled={page * 10 >= total}
                onClick={() => setPage(page + 1)}
              >
                Berikutnya
              </button>
            </div>
          </>
        )}
      </section>
      {detail && (
        <ResponsiveDialog
          title={`Detail pengukuran ${cfg.label}`}
          onClose={() => setDetail(null)}
        >
          <p>
            {displayDate(detail.date)} · {detail.time} WIB · {detail.officer}
          </p>
          <div className="flex gap-3 flex-wrap my-4">
            {detail.values.map((v, i) => (
              <span className="tag" key={i}>
                {i + 1}: {temperature(v)}
              </span>
            ))}
          </div>
          <Status value={detail.status} />
          <p className="caption my-3">
            Versi SOP:{" "}
            {detail.policyVersion || "Historis / belum memiliki versi"}
          </p>
          {detail.deviceStates?.map((d) => (
            <section className="my-3" key={d.deviceNumber}>
              <strong>
                {cfg.label} {d.deviceNumber}
              </strong>
              {d.missingReason && <p>Alasan belum diukur: {d.missingReason}</p>}
              {d.correctiveAction && (
                <>
                  <p>{d.correctiveAction}</p>
                  <p>Dilakukan Oleh: {d.performedBy}</p>
                  <p>Status Tindakan: {d.actionStatus}</p>
                </>
              )}
            </section>
          ))}
          <p className="my-4 whitespace-pre-wrap">
            {detail.notes || "Tidak ada keterangan."}
          </p>
          <img
            src={`/api/signatures/${detail.signatureId}`}
            className="signature-preview"
            alt="Tanda tangan petugas"
          />
          <small className="muted block break-all">
            Record ID: {detail.id}
            <br />
            Diperbarui: {detail.updatedAt}
          </small>
          <button
            autoFocus
            className="btn primary mt-5"
            onClick={() => setDetail(null)}
          >
            Tutup
          </button>
        </ResponsiveDialog>
      )}
    </ConfigProvider>
  );
}
