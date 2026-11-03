export type FailureCategory = "network" | "timeout" | "http" | "response";
export class ApiError extends Error {
  constructor(
    message: string,
    public category: FailureCategory,
    public status?: number,
    public reason?: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
type Envelope = {
  success?: boolean;
  data?: unknown;
  message?: string;
  error?: { reason?: string };
};
/** Mutations are never automatically retried; callers retain idempotency keys. */
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    const headers = new Headers(options?.headers);
    if (typeof options?.body === "string" && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const res = await fetch(url, {
      ...options,
      headers,
      signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    const requestId = res.headers.get("X-Request-ID") || undefined;
    const text = await res.text();
    let body: Envelope | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") body = parsed as Envelope;
    } catch {
      /* A proxy may return HTML. */
    }
    const reason =
      typeof body?.error?.reason === "string" ? body.error.reason : undefined;
    let message =
      res.status === 401
        ? "Sesi Anda telah berakhir. Silakan masuk kembali."
        : res.status === 403
          ? "Anda tidak memiliki izin melakukan tindakan ini."
          : res.status === 413
            ? "Ukuran tanda tangan terlalu besar."
            : reason?.startsWith("STORAGE_")
              ? "Penyimpanan tanda tangan sedang tidak tersedia. Data belum dikonfirmasi tersimpan."
              : reason?.startsWith("GOOGLE_")
                ? "Data belum berhasil dikonfirmasi tersimpan. Layanan Google Sheets sedang tidak tersedia atau izin akses belum sesuai."
                : res.status >= 500
                  ? "Server belum dapat mengonfirmasi penyimpanan. Pertahankan isian dan coba kembali dengan tombol yang sama."
                  : "Respons server tidak valid. Periksa riwayat sebelum mengulangi penyimpanan.";
    if (!res.ok || body?.success !== true || !("data" in body)) {
      if (
        ![401, 403, 413].includes(res.status) &&
        res.status < 500 &&
        typeof body?.message === "string"
      )
        message = body.message;
      throw new ApiError(
        message,
        body ? "http" : "response",
        res.status,
        reason,
        requestId,
      );
    }
    return body.data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted)
      throw new ApiError(
        "Waktu tunggu permintaan habis. Pertahankan isian dan periksa riwayat; coba kembali dengan tombol yang sama agar tidak duplikat.",
        "timeout",
      );
    throw new ApiError(
      "Koneksi ke server terputus. Pertahankan isian dan coba kembali dengan tombol yang sama. Jangan reset sebelum memeriksa riwayat.",
      "network",
    );
  } finally {
    clearTimeout(timeout);
  }
}
