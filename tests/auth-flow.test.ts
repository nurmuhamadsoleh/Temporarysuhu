import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  find: vi.fn(),
  sync: vi.fn(),
  getFile: vi.fn(),
  putFile: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/server/storage", () => ({
  locked: async (fn: () => Promise<unknown>) => fn(),
  getFile: m.getFile,
  putFile: m.putFile,
}));
vi.mock("@/lib/server/user-service", () => ({
  findUser: m.find,
  findGoogleUser: m.find,
  syncGoogleIdentity: m.sync,
  legacyActor: vi.fn(),
  legacyAccount: vi.fn(),
}));
import { authOptions } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { authErrorMessage } from "@/lib/auth-feedback";
const jwt = authOptions.callbacks!.jwt!,
  session = authOptions.callbacks!.session!;
const identity = {
  sub: "verified-google-sub",
  email: "operator@example.test",
  name: "Pemilik Pengukuran",
  email_verified: true,
};
const owner = {
  id: "owner-id",
  googleId: identity.sub,
  name: identity.name,
  email: identity.email,
  picture: "",
  role: "PETUGAS",
  status: "ACTIVE",
};
function input() {
  return {
    token: {},
    account: {
      provider: "google",
      type: "oauth",
      providerAccountId: identity.sub,
    },
    profile: identity,
    user: { id: identity.sub },
  } as Parameters<typeof jwt>[0];
}
function sessionInput(
  token: Parameters<typeof session>[0]["token"],
): Parameters<typeof session>[0] {
  return {
    session: {
      user: {
        id: owner.id,
        googleId: identity.sub,
        name: identity.name,
        email: identity.email,
        image: null,
        picture: "",
        role: "PETUGAS",
        status: "ACTIVE",
        googleVerified: true,
        authoritativeEmail: true,
        provider: "google",
      },
      expires: "2027-01-01",
    },
    token,
    user: { id: owner.id, email: identity.email, emailVerified: null },
    newSession: {},
    trigger: "update",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.getFile.mockResolvedValue(Buffer.from("{}"));
  m.putFile.mockResolvedValue(undefined);
  m.sync.mockResolvedValue(owner);
  m.find.mockResolvedValue(owner);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it.each(["ACTIVE", "PENDING", "SUSPENDED", "REJECTED"])(
  "maps %s from APP_USERS rather than frontend claims",
  async (status) => {
    m.sync.mockResolvedValue({ ...owner, status });
    m.find.mockResolvedValue({ ...owner, status });
    const token = await jwt(input());
    const result = await session(sessionInput(token));
    expect(result.user).toMatchObject({
      id: owner.id,
      googleId: identity.sub,
      role: "PETUGAS",
      status,
      googleVerified: true,
    });
    expect(token).not.toHaveProperty("role", "SUPER_ADMIN");
  },
);
it("does not grant a registered role to a verified Google identity absent from APP_USERS", async () => {
  m.sync.mockResolvedValue(null);
  m.find.mockResolvedValue(undefined);
  const token = await jwt(input());
  const result = await session(sessionInput(token));
  expect(result.user).toMatchObject({
    id: "",
    role: null,
    status: "UNREGISTERED",
    googleVerified: true,
  });
});
it("rejects failed account lookup and logs the stage without identity, tokens or raw exception", async () => {
  m.sync.mockRejectedValue(new AppError(503, "DO-NOT-LOG-TOKEN"));
  await expect(jwt(input())).rejects.toMatchObject({ status: 503 });
  const output = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(output).toContain("OAUTH_USER_STORE_UNAVAILABLE");
  expect(output).not.toContain("DO-NOT-LOG");
  expect(output).not.toContain(identity.email);
  expect(output).not.toContain(identity.sub);
});
it("fails session refresh closed when APP_USERS cannot be read", async () => {
  m.find.mockRejectedValue(new AppError(503, "DO-NOT-LOG-PRIVATE-KEY"));
  await expect(
    session(
      sessionInput({
        id: owner.id,
        provider: "google",
        googleVerified: true,
        googleId: identity.sub,
      }),
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
    "SESSION_USER_STORE_UNAVAILABLE",
  );
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "DO-NOT-LOG",
  );
});
it("does not bypass storage-backed rate limiting to create a Google session", async () => {
  m.getFile.mockRejectedValue(new Error("DO-NOT-LOG-STORAGE-PATH"));
  await expect(jwt(input())).rejects.toMatchObject({ status: 503 });
  expect(m.sync).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
    "OAUTH_STORAGE_UNAVAILABLE",
  );
});
it("uses an error destination independent of session and rejects external callback redirects", async () => {
  expect(authOptions.pages?.error).toBe("/auth/error");
  const redirect = authOptions.callbacks!.redirect!;
  expect(
    await redirect({
      url: "https://attacker.example/",
      baseUrl: "https://temperatursuhu.bogarasatama.com",
    }),
  ).toBe("https://temperatursuhu.bogarasatama.com/auth/continue");
});
it.each([
  "<script>secret</script>",
  "__proto__",
  "constructor",
  "TOKEN-DO-NOT-RENDER",
])("never echoes untrusted error code %j", (value) => {
  expect(authErrorMessage(value)).not.toContain(value);
});
