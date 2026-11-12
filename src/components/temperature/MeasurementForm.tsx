"use client";
import { useEffect, useRef, useState } from "react";
import { signatureBlob } from "@/lib/client/canvas";
import { ApiError } from "@/lib/client/api";
import { Controller, useForm, useWatch, useFieldArray } from "react-hook-form";
import type SignatureCanvas from "react-signature-canvas";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { SignaturePad } from "@/components/signature/SignaturePad";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfigProvider, DatePicker, TimePicker } from "antd";
import idID from "antd/locale/id_ID";
import dayjs from "dayjs";
import "dayjs/locale/id";
import {
  DynamicTemperatureForm,
  type FormDeviceEntry,
} from "./DynamicTemperatureForm";
import {
  defaultDevices,
  measurementRefs,
  measurementIndex,
  measurementValue,
  MAX_MEASUREMENT_DEVICES,
} from "@/lib/devices";
import { parseTemperatureText } from "@/lib/temperature-input";
import type { RegisteredDevice } from "@/lib/server/sheets";
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
import { type MeasurementFields as Fields } from "./DeviceCorrectionFields";
import {
  DEFAULT_TEMPERATURE_POLICY,
  getRecordedTemperatureStatus,
  statusPalette,
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
  const registry = useData<RegisteredDevice[]>(
    "/api/devices?includeInactive=true",
  );
  const registrySnapshot = useRef<RegisteredDevice[] | null>(null),
    registryFingerprint = useRef("");
  const sopData = useData<TemperaturePolicy>("/api/temperatures/policy");
  const policy = sopData.data ?? {
    ...DEFAULT_TEMPERATURE_POLICY,
    freezer: initialSop.freezer
      ? {
          ...initialSop.freezer,
          warningMax:
            initialSop.freezer.min ===
              DEFAULT_TEMPERATURE_POLICY.freezer?.min &&
            initialSop.freezer.max === DEFAULT_TEMPERATURE_POLICY.freezer?.max
              ? DEFAULT_TEMPERATURE_POLICY.freezer.warningMax
              : null,
        }
      : DEFAULT_TEMPERATURE_POLICY.freezer,
  };
  const cfg = config[kind],
    canvas = useRef<SignatureCanvas>(null),
    pending = useRef<{
      content: string;
      signatureId: string | null;
      signatureKey: string;
      signatureRevision: number;
      blob: Blob | null;
      key: string;
    } | null>(null),
    signatureRevision = useRef(0),
    saving = useRef(false),
    [saveError, setSaveError] = useState(""),
    [sessionExpired, setSessionExpired] = useState(false),
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
    getValues,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<Fields>({
    defaultValues: {
      ...initialMetadata,
      values: defaultDevices(kind).map(() => null),
      deviceEntries: defaultDevices(kind).map((d) => ({
        ...d,
        persisted: true,
        version: "initial-v1",
      })),
      notes: "",
      devices: defaultDevices(kind).map(emptyDeviceInput),
    },
  });
  const { append: appendEntry, replace: replaceEntries } = useFieldArray({
    control,
    name: "deviceEntries",
    keyName: "formKey",
  });
  const entries = useWatch({ control, name: "deviceEntries" }) ?? [];
  const { data, error, loading, refresh } = useData<Measurement[]>(
    `/api/temperatures/${kind}?q=${encodeURIComponent(search)}&from=${date}&to=${date}`,
  );
  const values = useWatch({ control, name: "values" });
  const canWrite = actor.role !== "SUPERVISOR";
  const resetForm = () => {
    const current = (
      registrySnapshot.current ??
      registry.data ??
      defaultDevices(kind).map((d) => ({ ...d, version: "initial-v1" }))
    ).filter((d) => d.kind === kind && d.active);
    reset({
      ...jakartaNow(),
      values: current.map(() => null),
      deviceEntries: current.map((d) => ({ ...d, persisted: true })),
      notes: "",
      devices: current.map(emptyDeviceInput),
    });
    canvas.current?.clear();
    setPreview("");
    setEditing(null);
    pending.current = null;
    signatureRevision.current = 0;
    setSaveError("");
    setSessionExpired(false);
  };
  useEffect(() => {
    if (!registry.data || busy || editing || pending.current) return;
    const fingerprint = JSON.stringify(
      registry.data
        .filter((d) => d.kind === kind)
        .map((d) => [d.id, d.version, d.active]),
    );
    if (registryFingerprint.current === fingerprint) return;
    const old = getValues(),
      existing = old.deviceEntries,
      configured = registry.data.filter((d) => d.kind === kind),
      active = configured.filter((d) => d.active);
    const next: FormDeviceEntry[] = active.map((d) => ({
      ...d,
      persisted: true,
    }));
    for (const d of existing.filter(
      (d) => d.persisted && !active.some((n) => n.id === d.id),
    )) {
      const index = existing.findIndex((n) => n.id === d.id);
      if (
        String(old.values[index] ?? "").trim() ||
        old.devices[index]?.missingReason ||
        old.devices[index]?.correctiveAction ||
        old.devices[index]?.performedBy ||
        (old.devices[index]?.actionStatus &&
          old.devices[index].actionStatus !== "PENDING")
      )
        next.push({ ...d, active: false });
    }
    let number = Math.max(0, ...configured.map((d) => d.number));
    for (const d of existing.filter(
      (d) => !d.persisted && !next.some((n) => n.id === d.id),
    ))
      next.push({ ...d, number: ++number });
    next.sort((a, b) => a.number - b.number);
    setValue(
      "values",
      next.map((d) => {
        const i = existing.findIndex((n) => n.id === d.id);
        return i < 0 ? null : old.values[i];
      }),
    );
    setValue(
      "devices",
      next.map((d) => {
        const i = existing.findIndex((n) => n.id === d.id);
        return i < 0 ? emptyDeviceInput() : old.devices[i];
      }),
    );
    replaceEntries(next);
    registrySnapshot.current = registry.data;
    registryFingerprint.current = fingerprint;
  }, [registry.data, busy, editing, kind, getValues, setValue, replaceEntries]);
  const removeInput = (id: string) => {
    if (busy || editing || pending.current) {
      toast.error(
        "Periksa hasil permintaan sebelumnya sebelum mengubah daftar input.",
      );
      return;
    }
    const fields = getValues(),
      index = fields.deviceEntries.findIndex((d) => d.id === id);
    if (
      index < 0 ||
      (fields.deviceEntries[index].persisted &&
        fields.deviceEntries[index].active)
    )
      return;
    setValue(
      "values",
      fields.values.filter((_, i) => i !== index),
    );
    setValue(
      "devices",
      fields.devices.filter((_, i) => i !== index),
    );
    const remaining = fields.deviceEntries.filter((d) => d.id !== id);
    let number = Math.max(
      0,
      ...remaining.filter((d) => d.persisted).map((d) => d.number),
      ...(registry.data ?? [])
        .filter((d) => d.kind === kind)
        .map((d) => d.number),
    );
    replaceEntries(
      remaining.map((d) => (d.persisted ? d : { ...d, number: ++number })),
    );
  };
  const addInput = () => {
    if (actor.role !== "SUPER_ADMIN" || editing || pending.current) return;
    const fields = getValues();
    if (fields.deviceEntries.length >= MAX_MEASUREMENT_DEVICES) {
      toast.error("Batas jumlah input tercapai.");
      return;
    }
    const number =
      Math.max(
        0,
        ...fields.deviceEntries.map((d) => d.number),
        ...(registry.data ?? [])
          .filter((d) => d.kind === kind)
          .map((d) => d.number),
      ) + 1;
    setValue("values", [...fields.values, null]);
    setValue("devices", [...fields.devices, emptyDeviceInput()]);
    appendEntry({
      id: crypto.randomUUID(),
      number,
      persisted: false,
      active: true,
      version: "draft",
    });
  };
  const persistEntry = async (
    entry: FormDeviceEntry,
  ): Promise<FormDeviceEntry> => {
    if (entry.persisted) return entry;
    if (actor.role !== "SUPER_ADMIN")
      throw new Error("Hanya Super Admin dapat mendaftarkan perangkat.");
    const saved = await api<RegisteredDevice>("/api/devices", {
      method: "POST",
      headers: { "Idempotency-Key": entry.id },
      body: JSON.stringify({ kind, expectedNumber: entry.number }),
    });
    const next = { ...saved, persisted: true };
    replaceEntries(
      getValues("deviceEntries").map((d) => (d.id === entry.id ? next : d)),
    );
    registrySnapshot.current = [
      ...(registrySnapshot.current ?? registry.data ?? []).filter(
        (d) => d.id !== saved.id,
      ),
      saved,
    ];
    if (saved.number !== entry.number)
      throw new Error(
        "Perangkat terdaftar sebagai " +
          saved.label +
          ". Periksa label sebelum menyimpan pengukuran kembali.",
      );
    return next;
  };
  const registerInput = async (id: string) => {
    if (busy || pending.current) return;
    const entry = getValues("deviceEntries").find((d) => d.id === id);
    if (!entry) return;
    setBusy(true);
    try {
      await persistEntry(entry);
      toast.success("Perangkat terdaftar dan tetap tersedia setelah refresh.");
      await registry.refresh();
    } catch (error) {
      await registry.refresh();
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deactivateInput = async (id: string) => {
    if (busy || pending.current) return;
    const entry = getValues("deviceEntries").find((d) => d.id === id);
    if (!entry) return;
    setBusy(true);
    try {
      await api("/api/devices/" + id, {
        method: "PATCH",
        body: JSON.stringify({ active: false, version: entry.version }),
      });
      await registry.refresh();
      toast.success("Perangkat dinonaktifkan; histori tetap tersedia.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const activateInput = async (device: RegisteredDevice) => {
    if (busy || pending.current) return;
    setBusy(true);
    try {
      await api("/api/devices/" + device.id, {
        method: "PATCH",
        body: JSON.stringify({ active: true, version: device.version }),
      });
      await registry.refresh();
      toast.success("Perangkat diaktifkan kembali.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    void handleSubmit(
      async (fields) => {
        setBusy(true);
        setSaveError("");
        setSessionExpired(false);
        try {
          let signatureId = editing?.signatureId;
          let numeric = fields.values.map((v) => {
            const parsed = parseTemperatureText(String(v ?? ""), kind);
            if (!parsed.valid) throw new Error(parsed.message);
            return parsed.value;
          });
          if (numeric.every((value) => value === null))
            throw new Error(
              "Isi minimal satu pembacaan suhu untuk menyimpan pengukuran.",
            );
          if (!registry.data)
            throw new Error("Daftar perangkat belum berhasil dimuat.");
          if (fields.deviceEntries.some((d) => !d.active) && !editing)
            throw new Error(
              "Keluarkan input perangkat nonaktif sebelum membuat pengukuran baru.",
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
          if (!editing && (!canvas.current || canvas.current.isEmpty()))
            throw new Error("Tanda tangan petugas wajib diisi");
          const registered: FormDeviceEntry[] = [];
          for (const entry of fields.deviceEntries)
            registered.push(await persistEntry(entry));
          const ordered = registered
            .map((ref, i) => ({
              ref,
              value: numeric[i],
              correction: fields.devices[i],
            }))
            .sort((a, b) => a.ref.number - b.ref.number);
          numeric = ordered.map((d) => d.value);
          const requestData = {
            date: fields.date,
            time: fields.time,
            values: numeric,
            devices: ordered.map((d) => d.correction),
            deviceRefs: ordered.map((d) => ({
              id: d.ref.id,
              number: d.ref.number,
            })),
            policyVersion: policy.version,
            notes: fields.notes,
          };
          if (!editing) {
            const content = JSON.stringify(requestData);
            if (
              pending.current &&
              (pending.current.content !== content ||
                pending.current.signatureRevision !== signatureRevision.current)
            )
              throw new Error(
                "Request sebelumnya belum dikonfirmasi. Kembalikan isian semula untuk retry, atau periksa riwayat sebelum mereset form.",
              );
            if (!pending.current)
              pending.current = {
                content,
                signatureRevision: signatureRevision.current,
                blob: null,
                signatureId: null,
                signatureKey: crypto.randomUUID(),
                key: crypto.randomUUID(),
              };
            if (!pending.current.signatureId) {
              // Retain the exact encoded image across retries and canvas resize.
              const blob =
                pending.current.blob ??
                (await signatureBlob(canvas.current!.getCanvas()));
              pending.current.blob = blob;
              const signature = await api<{ id: string }>("/api/signatures", {
                method: "POST",
                headers: {
                  "Content-Type": "image/png",
                  "Idempotency-Key": pending.current.signatureKey,
                  "X-Temperature-Type": kind,
                },
                body: blob,
              });
              pending.current.signatureId = signature.id;
            }
            signatureId = pending.current.signatureId;
          }
          const saved = await api<Measurement>(
            `/api/temperatures/${kind}${editing ? `/${editing.id}` : ""}`,
            {
              method: editing ? "PATCH" : "POST",
              headers: editing
                ? {}
                : { "Idempotency-Key": pending.current!.key },
              body: JSON.stringify({
                ...requestData,
                signatureId,
                ...(editing ? { version: editing.updatedAt } : {}),
              }),
            },
          );
          if (
            !saved?.id ||
            saved.kind !== kind ||
            JSON.stringify(saved.deviceRefs) !==
              JSON.stringify(requestData.deviceRefs) ||
            JSON.stringify(saved.values) !== JSON.stringify(numeric)
          )
            throw new ApiError(
              "Respons penyimpanan belum dapat diverifikasi. Pertahankan isian dan periksa riwayat sebelum mengulangi.",
              "response",
            );
          toast.success(
            editing ? "Perubahan tersimpan" : "Data tersimpan di Google Sheets",
          );
          resetForm();
          window.dispatchEvent(new Event("tempcontrol:measurements-updated"));
          router.refresh();
        } catch (e) {
          if (e instanceof ApiError && e.status === 409)
            await registry.refresh();
          const message =
            (e as Error).message +
            (e instanceof ApiError && e.requestId
              ? " Kode bantuan: " + e.requestId
              : "");
          setSaveError(message);
          setSessionExpired(e instanceof ApiError && e.status === 401);
          toast.error(message);
        } finally {
          setBusy(false);
          saving.current = false;
        }
      },
      () => {
        saving.current = false;
      },
    )(event);
  };
  const edit = (r: Measurement) => {
    setEditing(r);
    pending.current = null;
    reset({
      date: r.date,
      time: r.time,
      values: r.values.map((v) =>
        v === null ? null : String(v).replace(".", ","),
      ),
      deviceEntries: measurementRefs(r).map((d) => ({
        ...d,
        persisted: true,
        active: registry.data?.find((n) => n.id === d.id)?.active ?? false,
        version: registry.data?.find((n) => n.id === d.id)?.version ?? "legacy",
      })),
      devices:
        r.deviceStates?.map((d) => ({
          missingReason: d.missingReason,
          correctiveAction: d.correctiveAction,
          performedBy: d.performedBy,
          actionStatus: d.actionStatus,
        })) ?? r.values.map(emptyDeviceInput),
      notes: r.notes,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const historyNumbers = [
    ...new Set([
      ...(registry.data ?? [])
        .filter((d) => d.kind === kind)
        .map((d) => d.number),
      ...(data ?? []).flatMap((r) => measurementRefs(r).map((d) => d.number)),
    ]),
  ].sort((a, b) => a - b);
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
            Catat pengukuran {entries.length} unit {cfg.label.toLowerCase()}{" "}
            dengan dokumentasi yang lengkap.
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
                Isi suhu dengan koma atau titik. Data disimpan hanya saat Simpan
                Data ditekan.
              </p>
            </div>
            <span className={`tag ${kind === "chiller" ? "cyan" : "indigo"}`}>
              {entries.length} unit {cfg.label}
            </span>
          </div>
          {saveError && (
            <div role="alert" className="sop-notice mb-4">
              <p>{saveError}</p>
              {sessionExpired && (
                <a href="/login" target="_blank" rel="noopener noreferrer">
                  Masuk kembali di tab baru dengan akun yang sama, lalu coba
                  simpan lagi.
                </a>
              )}
            </div>
          )}
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
                {
                  values.filter((v) => {
                    const parsed = parseTemperatureText(String(v ?? ""), kind);
                    return parsed.valid && parsed.value !== null;
                  }).length
                }
                /{entries.length} terkonfirmasi
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
            {registry.error && (
              <ErrorBox message={registry.error} retry={registry.refresh} />
            )}
            <DynamicTemperatureForm
              kind={kind}
              entries={entries}
              control={control}
              trigger={trigger}
              policy={policy}
              disabled={busy || !registry.data}
              canManage={actor.role === "SUPER_ADMIN"}
              editing={!!editing}
              onAdd={addInput}
              onRemove={removeInput}
              onRegister={(id) => void registerInput(id)}
              onDeactivate={(id) => void deactivateInput(id)}
            />
            {actor.role === "SUPER_ADMIN" &&
              !editing &&
              (registry.data ?? []).some(
                (d) => d.kind === kind && !d.active,
              ) && (
                <details className="mt-4">
                  <summary>Perangkat nonaktif · histori tetap tersedia</summary>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {(registry.data ?? [])
                      .filter((d) => d.kind === kind && !d.active)
                      .map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          disabled={busy}
                          className="btn secondary"
                          onClick={() => void activateInput(d)}
                        >
                          Aktifkan {d.label}
                        </button>
                      ))}
                  </div>
                </details>
              )}
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
                    <SignaturePad
                      padRef={canvas}
                      disabled={busy}
                      onChange={() => {
                        signatureRevision.current++;
                      }}
                    />
                    <div className="flex gap-4 mt-2">
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => {
                          signatureRevision.current++;
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
                  disabled={
                    busy || !sopData.data || !registry.data || !entries.length
                  }
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
                    {historyNumbers.map((number) => (
                      <th key={number}>
                        {cfg.label} {number}
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
                      {historyNumbers.map((number) => {
                        const i = measurementIndex(r, number),
                          v = measurementValue(r, number);
                        return (
                          <td key={number}>
                            {i < 0 ? (
                              <span title="Perangkat tidak termasuk pencatatan ini">
                                —
                              </span>
                            ) : (
                              <>
                                <span
                                  style={
                                    kind === "freezer"
                                      ? {
                                          color:
                                            statusPalette[
                                              getRecordedTemperatureStatus(r, i)
                                            ].color,
                                        }
                                      : undefined
                                  }
                                >
                                  {temperature(v ?? null)}
                                </span>
                                {r.deviceStates?.[i] && (
                                  <div className="mt-1">
                                    <Status
                                      value={
                                        r.deviceStates[i].temperatureStatus
                                      }
                                    />
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                        );
                      })}
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
              <span className="tag" key={measurementRefs(detail)[i].id}>
                {measurementRefs(detail)[i].number}: {temperature(v)}
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
