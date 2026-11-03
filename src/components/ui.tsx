"use client";
import { statusPalette } from "@/lib/temperature-policy";
import { useCallback, useEffect, useState, useRef } from "react";
import { AlertCircle, RefreshCw, Inbox } from "lucide-react";
import { api } from "@/lib/client/api";
export { api };
export function useData<T>(url: string, initialData?: T) {
  const requestNumber = useRef({ value: 0 });
  const [data, setData] = useState<T | null>(initialData ?? null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(initialData === undefined);
  const refresh = useCallback(async () => {
    const number = ++requestNumber.current.value;
    setLoading(true);
    setError("");
    try {
      const result = await api<T>(url);
      if (number !== requestNumber.current.value) return;
      setData(result);
    } catch (e) {
      if (number !== requestNumber.current.value) return;
      setData(null);
      setError((e as Error).message);
    } finally {
      if (number === requestNumber.current.value) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    const counter = requestNumber.current;
    void refresh();
    return () => {
      counter.value++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!/^\/api\/(temperatures|dashboard|reports)/.test(url)) return;
    const updated = () => void refresh();
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("tempcontrol:measurements-updated", updated);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("tempcontrol:measurements-updated", updated);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [url, refresh]);
  return { data, error, loading, refresh };
}
export function Loading() {
  return (
    <div className="grid gap-5 md:grid-cols-3" aria-label="Memuat data">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="h-36 animate-pulse rounded-2xl bg-slate-200/70"
        />
      ))}
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="notice">
      <AlertCircle size={22} />
      <div>
        <strong>Data belum dapat dimuat</strong>
        <p>{message}</p>
        {retry && (
          <button className="btn secondary mt-3" onClick={retry}>
            <RefreshCw size={15} />
            Coba lagi
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty() {
  return (
    <div className="empty">
      <Inbox size={36} />
      <h3>Belum ada pengukuran</h3>
      <p>Data yang tersimpan di Google Sheets akan ditampilkan di sini.</p>
    </div>
  );
}
export function Status({ value }: { value: string }) {
  const code = value === "BELUM DIKONFIGURASI" ? "UNKNOWN_SOP" : value;
  const status = statusPalette[code as keyof typeof statusPalette];
  if (status)
    return (
      <span
        className="status"
        style={{
          color: status.color,
          background: status.background,
          whiteSpace: "normal",
        }}
      >
        {status.label}
      </span>
    );
  return (
    <span
      className={`status ${value === "ALERT" ? "alert" : value === "NORMAL" || value === "SIGNED" ? "normal" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
