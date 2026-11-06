"use client";
import { Button, Popconfirm, Tag } from "antd";
import { Controller, type Control, type UseFormTrigger } from "react-hook-form";
import type { Kind } from "@/lib/domain";
import { parseTemperatureText } from "@/lib/temperature-input";
import {
  getTemperatureStatus,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
import { TemperatureInputField } from "./TemperatureInputField";
import {
  DeviceCorrectionFields,
  type MeasurementFields,
} from "./DeviceCorrectionFields";
export type FormDeviceEntry = {
  id: string;
  number: number;
  persisted: boolean;
  active: boolean;
  version: string;
};
export function DynamicTemperatureForm({
  kind,
  entries,
  control,
  trigger,
  policy,
  disabled,
  canManage,
  editing,
  onAdd,
  onRemove,
  onRegister,
  onDeactivate,
}: {
  kind: Kind;
  entries: FormDeviceEntry[];
  control: Control<MeasurementFields>;
  trigger: UseFormTrigger<MeasurementFields>;
  policy: TemperaturePolicy;
  disabled: boolean;
  canManage: boolean;
  editing: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRegister: (id: string) => void;
  onDeactivate: (id: string) => void;
}) {
  const label = kind === "chiller" ? "Chiller" : "Freezer";
  return (
    <section aria-label={"Input suhu " + label}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((device, index) => (
          <Controller
            key={device.id}
            control={control}
            name={`values.${index}`}
            rules={{
              validate: (value) => {
                const result = parseTemperatureText(String(value ?? ""), kind);
                return result.valid || result.message;
              },
            }}
            render={({ field, fieldState }) => {
              const parsed = parseTemperatureText(
                  String(field.value ?? ""),
                  kind,
                ),
                value = parsed.valid ? parsed.value : null;
              return (
                <TemperatureInputField
                  id={"temperature-" + device.id}
                  deviceType={kind}
                  deviceNumber={device.number}
                  value={field.value}
                  status={
                    parsed.valid
                      ? getTemperatureStatus(kind, value, policy)
                      : null
                  }
                  onChange={field.onChange}
                  onBlur={() => {
                    field.onBlur();
                    void trigger(`values.${index}`);
                  }}
                  disabled={disabled || (!device.active && !editing)}
                  error={fieldState.error?.message}
                  onRemove={
                    !editing && (!device.persisted || !device.active)
                      ? () => onRemove(device.id)
                      : undefined
                  }
                >
                  {!device.persisted && (
                    <div className="mb-4">
                      <Tag>Input sementara</Tag>
                      <p className="caption">
                        Hapus input ini sebelum terdaftar, atau daftarkan
                        perangkat agar tetap muncul setelah refresh. Simpan data
                        juga mendaftarkan perangkat baru.
                      </p>
                      <Button
                        disabled={disabled || !canManage}
                        onClick={() => onRegister(device.id)}
                      >
                        Daftarkan perangkat
                      </Button>
                    </div>
                  )}
                  {!device.active && (
                    <p role="alert" className="field-error mb-3">
                      Perangkat dinonaktifkan. Histori tetap tersimpan;
                      keluarkan input ini sebelum pencatatan baru.
                    </p>
                  )}
                  <DeviceCorrectionFields
                    index={index}
                    deviceNumber={device.number}
                    value={value}
                    incomplete={!parsed.valid}
                    type={kind}
                    policy={policy}
                    control={control}
                    disabled={disabled}
                  />
                  {canManage &&
                    device.persisted &&
                    device.active &&
                    !editing && (
                      <Popconfirm
                        title={
                          "Nonaktifkan " + label + " " + device.number + "?"
                        }
                        description="Histori tetap tersedia. Perangkat tidak muncul pada pencatatan berikutnya."
                        onConfirm={() => onDeactivate(device.id)}
                      >
                        <Button className="mt-3" disabled={disabled}>
                          Nonaktifkan perangkat
                        </Button>
                      </Popconfirm>
                    )}
                </TemperatureInputField>
              );
            }}
          />
        ))}
      </div>
      {!entries.length && (
        <p className="sop-notice">
          Tidak ada perangkat aktif. Super Admin dapat menambahkan perangkat.
        </p>
      )}
      <Button
        className="mt-5 w-full md:w-auto"
        size="large"
        onClick={onAdd}
        disabled={disabled || !canManage || editing}
      >
        + Tambah Input {label}
      </Button>
      {!canManage && (
        <p className="caption mt-2">
          Penambahan perangkat permanen dikelola Super Admin.
        </p>
      )}
    </section>
  );
}
