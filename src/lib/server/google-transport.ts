import "server-only";

/**
 * Gaxios supports native fetch. Its default node-fetch Response exposes a Gunzip
 * stream that React's development debug serializer traverses (DEP0108).
 * Resolve fetch at request time so Next.js instrumentation remains active, and
 * never cache authenticated service-account requests in the Next.js data cache.
 */
export const googleFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...init, cache: "no-store" });
