import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/server/errors";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  find: vi.fn(),
  legacy: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/server/user-service", () => ({
  findUser: m.find,
  findGoogleUser: m.find,
  legacyActor: m.legacy,
  legacyAccount: vi.fn(),
  syncGoogleIdentity: m.sync,
}));
import {
  requireActor,
  requireGoogleIdentity,
  authOptions,
} from "@/lib/server/auth";
const user = {
  id: "id",
  googleId: "sub",
  name: "Operator",
  email: "a@gmail.com",
  picture: "",
  role: "PETUGAS",
  status: "ACTIVE",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({
    user: {
      ...user,
      provider: "google",
      googleVerified: true,
      authoritativeEmail: true,
    },
  });
  m.find.mockResolvedValue(user);
});
describe("Server authorization", () => {
  it("fails closed when APP_USERS is unavailable, even for a previously active session", async () => {
    m.find.mockRejectedValueOnce(new AppError(503, "Database unavailable"));
    await expect(requireActor()).rejects.toMatchObject({ status: 503 });
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests", async () => {
    m.session.mockResolvedValue(null);
    await expect(requireActor()).rejects.toMatchObject({ status: 401 });
  });
  it("uses current database role rather than stale token or frontend role", async () => {
    m.session.mockResolvedValue({
      user: {
        ...user,
        role: "SUPER_ADMIN",
        provider: "google",
        googleVerified: true,
      },
    });
    await expect(requireActor(["SUPER_ADMIN"])).rejects.toMatchObject({
      status: 403,
    });
    expect((await requireActor()).role).toBe("PETUGAS");
    m.find.mockResolvedValue({ ...user, role: "SUPERVISOR" });
    expect((await requireActor()).role).toBe("SUPERVISOR");
  });
  it.each(["PENDING", "SUSPENDED", "REJECTED"])(
    "revokes %s accounts immediately",
    async (status) => {
      m.find.mockResolvedValue({ ...user, status });
      await expect(requireActor()).rejects.toMatchObject({ status: 403 });
    },
  );
  it("rejects mismatched Google ID even with an active session", async () => {
    m.find.mockResolvedValue({ ...user, googleId: "other-sub" });
    await expect(requireActor()).rejects.toMatchObject({ status: 403 });
  });
  it("Super Admin retains all monitoring permissions", async () => {
    m.find.mockResolvedValue({ ...user, role: "SUPER_ADMIN" });
    expect((await requireActor(["ADMIN"])).role).toBe("SUPER_ADMIN");
  });
  it("requires verified Google session for registration", async () => {
    m.session.mockResolvedValue({
      user: { ...user, provider: "credentials", googleVerified: false },
    });
    await expect(requireGoogleIdentity()).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects invalid and unverified Google callback profiles", async () => {
    const callback = authOptions.callbacks!.signIn!;
    const account = {
      provider: "google",
      type: "oauth" as const,
      providerAccountId: "sub",
    };
    expect(
      await callback({
        user: { id: "sub" },
        account,
        profile: {
          sub: "sub",
          email: "a@gmail.com",
          name: "A",
          ...{ email_verified: false },
        },
      }),
    ).toBe(false);
    expect(
      await callback({
        user: { id: "sub" },
        account,
        profile: {
          sub: "other",
          email: "a@gmail.com",
          name: "A",
          ...{ email_verified: true },
        },
      }),
    ).toBe(false);
    expect(
      await callback({
        user: { id: "sub" },
        account,
        profile: {
          sub: "sub",
          email: "a@gmail.com",
          name: "A",
          ...{ email_verified: true },
        },
      }),
    ).toBe(true);
  });
  it("uses Google provider with only minimal scopes and callback protections", () => {
    const google = authOptions.providers.find((p) => p.id === "google")!;
    expect(google).toMatchObject({
      options: {
        checks: ["pkce", "state", "nonce"],
        authorization: { params: { scope: "openid email profile" } },
      },
    });
  });
});
