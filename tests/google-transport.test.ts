import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { googleFetch } from "@/lib/server/google-transport";
import { getSpreadsheetClient } from "@/lib/server/sheets";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Google API native transport", () => {
  it("keeps request identity, body and signal while preventing Next data caching", async () => {
    const response = new Response('{"ok":true}');
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const signal = new AbortController().signal;
    const init = {
      method: "POST",
      headers: {
        Authorization: "Bearer test-only",
        "Content-Type": "application/json",
      },
      body: '{"temperature":1.8}',
      signal,
      cache: "force-cache" as const,
    };
    expect(
      await googleFetch("https://sheets.googleapis.com/test-only", init),
    ).toBe(response);
    expect(fetch).toHaveBeenCalledWith(
      "https://sheets.googleapis.com/test-only",
      {
        ...init,
        cache: "no-store",
      },
    );
    expect(init.cache).toBe("force-cache");
  });

  it("uses the same transport for Sheets and JWT token requests", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "test@example.invalid");
    vi.stubEnv(
      "GOOGLE_PRIVATE_KEY",
      generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey,
    );
    vi.stubEnv("GOOGLE_SPREADSHEET_ID", "test-only-spreadsheet-12345678");
    const client = getSpreadsheetClient();
    expect(client.context._options.fetchImplementation).toBe(googleFetch);
    const auth = client.context._options.auth as {
      transporter: { defaults: { fetchImplementation?: unknown } };
    };
    expect(auth.transporter.defaults.fetchImplementation).toBe(googleFetch);
  });

  it("decodes gzip JSON into a web Response without a Node Gunzip body", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      });
      res.end(
        gzipSync(
          JSON.stringify({ chiller: 1.8, freezer: -18.5, missing: null }),
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as { port: number };
      const response = await googleFetch(`http://127.0.0.1:${address.port}`);
      expect(response.body).toBeInstanceOf(ReadableStream);
      expect(await response.json()).toEqual({
        chiller: 1.8,
        freezer: -18.5,
        missing: null,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
