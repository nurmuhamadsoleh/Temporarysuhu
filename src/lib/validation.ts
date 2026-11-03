import { z } from "zod";
// Keep the same schema validation under strict browser CSP; avoid Zod's eval probe.
if (typeof window !== "undefined") z.config({ jitless: true });
export { z };
