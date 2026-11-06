"use client";
import { useId, type ReactNode } from "react";
import {
  Button,
  Card,
  ConfigProvider,
  Slider,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { Thermometer, Snowflake } from "lucide-react";
import { config, normalize, temperature, type Kind } from "@/lib/domain";
import {
  DEFAULT_TEMPERATURE_POLICY,
  FREEZER_TEMPERATURE_POLICY,
  getTemperatureStatus,
  type TemperaturePolicy,
} from "@/lib/temperature-policy";
export type TemperatureVerticalSliderProps = {
  type: Kind;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  policy?: TemperaturePolicy;
  children?: ReactNode;
  sop?: { min: number; max: number } | null;
};
export function TemperatureVerticalSlider({
  type,
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  error,
  sop,
  policy,
  children,
}: TemperatureVerticalSliderProps) {
  const id = useId(),
    cfg = config[type],
    chosen = value !== null,
    active = value ?? cfg.min;
  const effectivePolicy = policy ?? {
    ...DEFAULT_TEMPERATURE_POLICY,
    ...(type === "freezer" && sop !== undefined
      ? {
          freezer: sop
            ? {
                ...sop,
                warningMax:
                  sop.min === FREEZER_TEMPERATURE_POLICY.normalMin &&
                  sop.max === FREEZER_TEMPERATURE_POLICY.normalMax
                    ? FREEZER_TEMPERATURE_POLICY.warningMax
                    : null,
              }
            : null,
        }
      : {}),
  };
  const status = getTemperatureStatus(type, value, effectivePolicy);
  const marks = Object.fromEntries(
    cfg.options.map((mark) => [
      mark,
      {
        style: { left: "auto", right: 0, transform: "translateY(50%)" },
        label: (
          <span key={mark} className="temperature-tick">
            {mark}°C
          </span>
        ),
      },
    ]),
  );
  return (
    <ConfigProvider
      theme={{
        components: {
          Slider: {
            trackBg: status.color,
            trackHoverBg: status.color,
            handleColor: status.color,
            handleActiveColor: status.color,
            dotActiveBorderColor: status.color,
          },
        },
      }}
    >
      <Card
        className={`temperature-vertical-card temperature-${type}${error ? " temperature-invalid" : ""}`}
        styles={{ body: { padding: "18px 12px", overflow: "visible" } }}
      >
        <div className="temperature-device-heading">
          <span className="temperature-device-icon">
            {type === "chiller" ? (
              <Thermometer size={18} />
            ) : (
              <Snowflake size={18} />
            )}
          </span>
          <Typography.Text strong id={`${id}-label`}>
            {label}
            {required && (
              <span aria-hidden="true" className="temperature-required">
                {" "}
                *
              </span>
            )}
          </Typography.Text>
        </div>
        <div className="temperature-active-value" aria-live="polite">
          <Typography.Text style={{ color: status.color }}>
            {chosen ? temperature(active) : "— °C"}
          </Typography.Text>
          <span>{chosen ? "Suhu dipilih" : "Belum diisi"}</span>
        </div>
        <div className="temperature-slider-stage">
          <div className="temperature-slider-axis">
            <Slider
              vertical
              reverse={false}
              included
              min={cfg.min}
              max={cfg.max}
              step={type === "freezer" ? FREEZER_TEMPERATURE_POLICY.step : 0.1}
              marks={marks}
              value={active}
              disabled={disabled}
              onChange={(v) => onChange(normalize(v))}
              style={{ height: "100%", margin: 0 }}
              ariaLabelledByForHandle={`${id}-label`}
              ariaRequired={required}
              ariaValueTextFormatterForHandle={(v) =>
                `${temperature(v)}${chosen ? "" : ", belum dikonfirmasi"}`
              }
              tooltip={{
                open: true,
                ...(type === "freezer" ? { color: status.color } : {}),
                zIndex: 900,
                placement: "right",
                formatter: (v) =>
                  !chosen
                    ? "BELUM DIISI"
                    : v === undefined
                      ? ""
                      : temperature(v),
                autoAdjustOverflow: true,
                fresh: true,
                className: "temperature-slider-tooltip",
                getPopupContainer: (trigger) => trigger.ownerDocument.body,
              }}
            />
          </div>
        </div>
        <div className="temperature-card-footer">
          <Tag
            style={{
              color: status.color,
              background: status.background,
              borderColor: status.color,
              whiteSpace: "normal",
              textAlign: "center",
            }}
          >
            {status.label}
          </Tag>
          <Typography.Text style={{ color: status.color }}>
            {status.description}
          </Typography.Text>
          {!chosen ? (
            <Button
              type="dashed"
              size="small"
              block
              disabled={disabled}
              onClick={() => onChange(normalize(active))}
            >
              Pilih {temperature(active)}
            </Button>
          ) : (
            <Typography.Text type="secondary" className="temperature-step-note">
              Presisi 0,1°C
            </Typography.Text>
          )}
          {chosen && (
            <Button
              size="small"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              Belum diukur
            </Button>
          )}
          <Tooltip
            title={
              sop
                ? `Batas SOP: ${temperature(sop.min)} sampai ${temperature(sop.max)}`
                : "Status NORMAL/ALERT hanya mengikuti batas SOP yang dikonfigurasi."
            }
          >
            <span className="temperature-sop-help">
              {sop
                ? `SOP ${temperature(sop.min)} – ${temperature(sop.max)}`
                : "Batas aman mengikuti SOP"}
            </span>
          </Tooltip>
          {error && (
            <span role="alert" className="temperature-error">
              {error}
            </span>
          )}
        </div>
        {children}
      </Card>
    </ConfigProvider>
  );
}
