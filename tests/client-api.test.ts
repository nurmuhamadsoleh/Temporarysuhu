import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/client/api";
import { signatureBlob } from "@/lib/client/canvas";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("encodes canvas locally without calling fetch", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const blob = new Blob(["fixture"], { type: "image/png" });
  const canvas = {
    toBlob: (callback: BlobCallback, type: string) => {
      expect(type).toBe("image/png");
      callback(blob);
    },
  } as HTMLCanvasElement;
  expect(await signatureBlob(canvas)).toBe(blob);
  expect(fetch).not.toHaveBeenCalled();
});
it("reports failed canvas encoding", async () => {
  await expect(
    signatureBlob({
      toBlob: (cb: BlobCallback) => cb(null),
    } as HTMLCanvasElement),
  ).rejects.toThrow("Tanda tangan");
});
it.each([
  [401, "Sesi"],
  [403, "izin"],
  [413, "besar"],
  [502, "Server"],
])("classifies HTTP %s without exposing HTML", async (status, message) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>private upstream details</html>", {
          status: Number(status),
        }),
      ),
  );
  await expect(api("/api/signatures")).rejects.toMatchObject({
    status,
    message: expect.stringContaining(message as string),
  });
});
it.each([
  ["STORAGE_EACCES", "tanda tangan"],
  ["GOOGLE_SHEETS_FORBIDDEN", "Google Sheets"],
])("classifies %s and retains correlation ID", async (reason, message) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { success: false, error: { reason } },
          { status: 503, headers: { "X-Request-ID": "safe-reference" } },
        ),
      ),
  );
  await expect(api("/api/signatures")).rejects.toMatchObject({
    reason,
    requestId: "safe-reference",
    message: expect.stringContaining(message),
  });
});
it("retains validated field errors and distinguishes invalid JSON", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { success: false, message: "Periksa kembali data pengukuran." },
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(new Response("not json"));
  vi.stubGlobal("fetch", fetch);
  await expect(api("/api/test")).rejects.toMatchObject({
    category: "http",
    status: 400,
    message: "Periksa kembali data pengukuran.",
  });
  await expect(api("/api/test")).rejects.toMatchObject({
    category: "response",
    status: 200,
  });
});
it("does not retry network failures or leak native exception details", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValue(new TypeError("Failed to fetch private-url"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    api("/api/temperatures/chiller", { method: "POST", body: "{}" }),
  ).rejects.toMatchObject({
    category: "network",
    message: expect.not.stringContaining("private-url"),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("aborts a stalled API after 60 seconds without retrying", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(
    (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new Error("timeout")),
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const assertion = expect(
    api("/api/test", { method: "POST" }),
  ).rejects.toMatchObject({ category: "timeout" });
  await vi.advanceTimersByTimeAsync(60001);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves headers and binary body and explicitly sends same-origin credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json({ success: true, data: { id: "confirmed" } }),
    );
  vi.stubGlobal("fetch", fetch);
  const body = new Blob(["fixture"]);
  const headers = new Headers({
    "Content-Type": "image/png",
    "Idempotency-Key": "same-key",
  });
  expect(
    await api("/api/signatures", { method: "POST", headers, body }),
  ).toEqual({ id: "confirmed" });
  const init = fetch.mock.calls[0][1];
  expect(init.body).toBe(body);
  expect(init.credentials).toBe("same-origin");
  expect(init.headers.get("Idempotency-Key")).toBe("same-key");
  expect(init.headers.get("Content-Type")).toBe("image/png");
});
