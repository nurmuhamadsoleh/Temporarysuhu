import { afterEach, it, expect, vi } from "vitest";
vi.mock("@/lib/domain", () => ({
  roles: ["SUPER_ADMIN", "ADMIN", "SUPERVISOR", "PETUGAS"],
}));
vi.mock("@/lib/users", () => ({ verifiedGoogleProfile: vi.fn() }));
// Provider configuration tests do not need the NextResponse/error renderer graph.
vi.mock("@/lib/server/errors", () => ({
  AppError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/server/user-service", () => ({
  findUser: vi.fn(),
  findGoogleUser: vi.fn(),
  syncGoogleIdentity: vi.fn(),
  legacyAccount: vi.fn(),
  legacyActor: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  locked: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each([undefined, "", "false", "FALSE", " false "])(
  "keeps Google and omits Credentials when legacy=%j",
  async (value) => {
    vi.resetModules();
    vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", value);
    const { authOptions, legacyEnabled } = await import("@/lib/server/auth");
    expect(legacyEnabled()).toBe(false);
    expect(authOptions.providers.map((p) => p.id)).toEqual(["google"]);
    const signIn = authOptions.callbacks!.signIn!;
    await expect(
      signIn({ account: { provider: "credentials" } } as Parameters<
        typeof signIn
      >[0]),
    ).resolves.toBe(false);
  },
);
it.each(["true", "TRUE", " true "])(
  "preserves explicit migration opt-in legacy=%j",
  async (value) => {
    vi.resetModules();
    vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", value);
    const { authOptions, legacyEnabled } = await import("@/lib/server/auth");
    expect(legacyEnabled()).toBe(true);
    expect(authOptions.providers.map((p) => p.id)).toEqual([
      "google",
      "credentials",
    ]);
  },
);
it("rejects invalid legacy configuration instead of enabling a fallback provider", async () => {
  vi.resetModules();
  vi.stubEnv("LEGACY_CREDENTIALS_ENABLED", "yes");
  await expect(import("@/lib/server/auth")).rejects.toThrow(
    "LEGACY_CREDENTIALS_ENABLED",
  );
});
