"use client";
import { Card, Input, Tag, Typography, Button, ConfigProvider } from "antd";
import { Thermometer } from "lucide-react";
import type { ReactNode } from "react";
import type { Kind } from "@/lib/domain";
import type { getTemperatureStatus } from "@/lib/temperature-policy";
export type TemperatureInputFieldProps = {
  id: string;
  deviceType: Kind;
  deviceNumber: number;
  value: string | number | null;
  status: ReturnType<typeof getTemperatureStatus> | null;
  onChange: (text: string) => void;
  onBlur?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  error?: string;
  children?: ReactNode;
};
export function TemperatureInputField({
  id,
  deviceType,
  deviceNumber,
  value,
  status,
  onChange,
  onBlur,
  onRemove,
  disabled,
  error,
  children,
}: TemperatureInputFieldProps) {
  const color = status?.color ?? "#64748B";
  const isFreezer = deviceType === "freezer";
  const inputColor = error ? "#DC2626" : color;
  return (
    <Card
      className="temperature-input-card min-w-0 h-full"
      styles={{ body: { padding: 20 } }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <label htmlFor={id} className="form-label">
          Suhu {deviceType === "chiller" ? "Chiller" : "Freezer"} {deviceNumber}
        </label>
        {onRemove && (
          <Button
            size="small"
            danger
            onClick={onRemove}
            disabled={disabled}
            aria-label={"Hapus input " + deviceType + " " + deviceNumber}
          >
            Hapus input
          </Button>
        )}
      </div>
      <ConfigProvider
        theme={
          isFreezer
            ? {
                components: {
                  Input: {
                    activeBorderColor: inputColor,
                    hoverBorderColor: inputColor,
                    activeShadow: "0 0 0 2px " + inputColor + "22",
                  },
                },
              }
            : undefined
        }
      >
        <Input
          id={id}
          size="large"
          placeholder="Masukkan suhu"
          suffix={
            isFreezer ? (
              <span
                className="inline-flex items-center gap-1"
                style={{ color: inputColor }}
              >
                <Thermometer size={16} aria-hidden="true" />
                <span>°C</span>
              </span>
            ) : (
              <span className="text-slate-600">°C</span>
            )
          }
          inputMode="decimal"
          value={value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          status={error ? "error" : undefined}
          maxLength={24}
          aria-invalid={!!error}
          aria-describedby={id + "-status" + (error ? " " + id + "-error" : "")}
          styles={{
            root: {
              minHeight: 44,
              ...(isFreezer && !disabled ? { borderColor: inputColor } : {}),
            },
          }}
        />
      </ConfigProvider>
      <div
        id={id + "-status"}
        className="mt-3 mb-4"
        aria-live="polite"
        role={isFreezer ? "status" : undefined}
        aria-label={
          isFreezer ? `Status suhu Freezer ${deviceNumber}` : undefined
        }
      >
        <Tag
          style={{
            color,
            background: status?.background ?? "#F1F5F9",
            borderColor: color,
            whiteSpace: "normal",
            ...(isFreezer
              ? { borderRadius: 999, fontSize: 12, lineHeight: "20px" }
              : {}),
          }}
        >
          {status?.label ?? "LENGKAPI NILAI SUHU"}
        </Tag>
        <Typography.Paragraph
          className="mt-2 mb-0"
          style={{
            color,
            ...(isFreezer
              ? {
                  fontSize: 14,
                  lineHeight: 1.5,
                  overflowWrap: "anywhere" as const,
                }
              : {}),
          }}
        >
          {status?.description ??
            "Nilai belum lengkap atau belum valid; belum dinilai sebagai suhu."}
        </Typography.Paragraph>
      </div>
      {error && (
        <p id={id + "-error"} role="alert" className="field-error mb-3">
          {error}
        </p>
      )}
      {children}
    </Card>
  );
}
