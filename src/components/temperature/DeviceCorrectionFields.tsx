"use client";
import { Form, Input, Select } from "antd";
import { Controller, type Control } from "react-hook-form";
import {
  actionStatusLabels,
  actionStatuses,
  getTemperatureStatus,
  type DeviceInput,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
import type { Kind } from "@/lib/domain";
export type MeasurementFields = {
  date: string;
  time: string;
  values: (number | null | string)[];
  deviceEntries: import("./DynamicTemperatureForm").FormDeviceEntry[];
  notes: string;
  devices: DeviceInput[];
};
export function DeviceCorrectionFields({
  index,
  deviceNumber,
  value,
  type,
  policy,
  control,
  disabled,
}: {
  index: number;
  deviceNumber?: number;
  value: number | null;
  type: Kind;
  policy: TemperaturePolicy;
  control: Control<MeasurementFields>;
  disabled: boolean;
}) {
  const status = getTemperatureStatus(type, value, policy),
    prefix = `${type}-${deviceNumber ?? index + 1}`;
  return (
    <div className="device-correction-fields">
      <Form component={false} layout="vertical">
        <h4>Koreksi / Tindakan Korektif</h4>
        <Controller
          control={control}
          name={`devices.${index}.correctiveAction`}
          rules={{
            validate: (v) =>
              !status.requiresCorrectiveAction ||
              !!v.trim() ||
              "Keterangan / tindakan korektif wajib diisi",
          }}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Keterangan / Tindakan Korektif"
              htmlFor={`${prefix}-action`}
              required={status.requiresCorrectiveAction}
              validateStatus={fieldState.error ? "error" : undefined}
              help={fieldState.error?.message}
            >
              <Input.TextArea
                {...field}
                id={`${prefix}-action`}
                disabled={disabled}
                rows={3}
                maxLength={2000}
                placeholder="Jelaskan kondisi perangkat atau tindakan perbaikan yang dilakukan."
              />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name={`devices.${index}.performedBy`}
          render={({ field }) => (
            <Form.Item label="Dilakukan Oleh" htmlFor={`${prefix}-by`}>
              <Input
                {...field}
                id={`${prefix}-by`}
                disabled={disabled}
                maxLength={150}
                placeholder="Masukkan nama petugas yang melakukan tindakan."
              />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name={`devices.${index}.actionStatus`}
          render={({ field }) => (
            <Form.Item label="Status Tindakan" htmlFor={`${prefix}-status`}>
              <Select
                {...field}
                id={`${prefix}-status`}
                disabled={disabled}
                options={actionStatuses.map((value) => ({
                  value,
                  label: actionStatusLabels[value],
                }))}
              />
            </Form.Item>
          )}
        />
        <p className="caption">
          Status tindakan tidak berarti telah diverifikasi Supervisor. Untuk
          Pending, pelaksana boleh kosong jika belum ditugaskan.
        </p>
      </Form>
    </div>
  );
}
