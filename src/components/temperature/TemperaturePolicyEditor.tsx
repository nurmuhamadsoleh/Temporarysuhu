"use client";
import { Button, Form, InputNumber, Switch } from "antd";
import { toast } from "sonner";
import { api, useData, ErrorBox, Loading } from "@/components/ui";
import type { TemperaturePolicy, PolicyBounds } from "@/lib/temperature-policy";
import { useState } from "react";
export function TemperaturePolicyEditor() {
  const { data, error, loading, refresh } = useData<TemperaturePolicy>(
      "/api/temperatures/policy",
    ),
    [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={refresh} />;
  if (!data) return null;
  return (
    <Form
      key={data.version}
      layout="vertical"
      initialValues={Object.fromEntries(
        (["chiller", "freezer"] as const).map((k) => [
          k,
          {
            enabled: !!data[k],
            min: data[k]?.min ?? null,
            max: data[k]?.max ?? null,
            warningMax: data[k]?.warningMax ?? null,
          },
        ]),
      )}
      onFinish={async (values) => {
        setBusy(true);
        try {
          const bounds = Object.fromEntries(
            (["chiller", "freezer"] as const).map((k) => [
              k,
              values[k].enabled
                ? {
                    min: values[k].min,
                    max: values[k].max,
                    warningMax: values[k].warningMax ?? null,
                  }
                : null,
            ]),
          ) as PolicyBounds;
          await api("/api/temperatures/policy", {
            method: "PUT",
            body: JSON.stringify({ bounds, version: data.version }),
          });
          toast.success("Versi SOP baru tersimpan");
          await refresh();
          window.dispatchEvent(new Event("tempcontrol:measurements-updated"));
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-6 md:grid-cols-2">
        {(["chiller", "freezer"] as const).map((k) => (
          <section key={k} className="sensor-card min-w-0">
            <h3 className="capitalize">SOP {k}</h3>
            <Form.Item
              name={[k, "enabled"]}
              label="Batas SOP ditetapkan"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name={[k, "min"]} label="Minimum normal (°C)">
              <InputNumber step={0.1} precision={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name={[k, "max"]} label="Maksimum normal (°C)">
              <InputNumber step={0.1} precision={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name={[k, "warningMax"]}
              label="Batas atas Warning (opsional, °C)"
            >
              <InputNumber step={0.1} precision={1} style={{ width: "100%" }} />
            </Form.Item>
          </section>
        ))}
      </div>
      <p className="caption my-3">
        Versi: {data.version}. Pengukuran historis mempertahankan penilaian dan
        versi SOP saat dicatat.
      </p>
      <Button type="primary" htmlType="submit" loading={busy}>
        Simpan kebijakan suhu
      </Button>
    </Form>
  );
}
