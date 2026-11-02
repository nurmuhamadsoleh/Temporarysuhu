import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  USER_HEADERS,
  LEGACY_HEADERS,
  ARCHIVE_HEADERS,
  encodeUser,
  decodeUser,
  verifiedGoogleProfile,
  type AppUser,
  type GoogleIdentity,
} from "@/lib/users";
const mock = vi.hoisted(() => ({
  rows: vi.fn(),
  batch: vi.fn(),
  ids: vi.fn(),
  ensure: vi.fn(),
}));
type Cell = {
  userEnteredValue: { stringValue?: string; numberValue?: number };
};
type Op = {
  append?: { sheetId: number; row: unknown[] };
  replace?: { sheetId: number; index: number; row: unknown[] };
  addSheet?: { properties: { sheetId: number; title: string } };
  updateCells?: { range: { sheetId: number }; rows: { values: Cell[] }[] };
};
vi.mock("@/lib/server/sheets", () => ({
  rows: mock.rows,
  batch: mock.batch,
  sheetIds: mock.ids,
  ensureSheetHeaders: mock.ensure,
  cells: (r: unknown[]) =>
    r.map((v) => ({
      userEnteredValue:
        typeof v === "number"
          ? { numberValue: v }
          : { stringValue: String(v ?? "") },
    })),
  append: (sheetId: number, row: unknown[]) => ({ append: { sheetId, row } }),
  replace: (sheetId: number, index: number, row: unknown[]) => ({
    replace: { sheetId, index, row },
  }),
  audit: (
    _ids: unknown,
    actor: { id: string },
    action: string,
    entity: string,
    before: unknown,
    after: unknown,
  ) => ({
    append: {
      sheetId: 2,
      row: [
        crypto.randomUUID(),
        new Date().toISOString(),
        actor.id,
        action,
        entity,
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    },
  }),
}));
import {
  syncGoogleIdentity,
  inviteUser,
  changeUser,
  userTable,
  legacyAccount,
  legacyActor,
} from "@/lib/server/user-service";
import {
  bootstrapSuperAdmin,
  migrateUsers,
} from "@/lib/server/user-provisioning";
let directory: string;
let state: Record<string, unknown[][]>;
let ids: Record<string, number>;
const identity: GoogleIdentity = {
  googleId: "verified-google-sub",
  email: "operator@gmail.com",
  name: "Operator",
  picture: "",
  authoritativeEmail: true,
};
const user = (extra: Partial<AppUser> = {}): AppUser => ({
  id: crypto.randomUUID(),
  googleId: crypto.randomUUID(),
  email: `${crypto.randomUUID()}@gmail.com`,
  name: "Test fixture",
  picture: "",
  role: "PETUGAS",
  status: "ACTIVE",
  registeredAt: "2026-11-01T01:00:00.000Z",
  approvedAt: "",
  approvedBy: "",
  lastLogin: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-01T01:00:00.000Z",
  createdBy: "fixture",
  updatedBy: "fixture",
  ...extra,
});
const add = (u: AppUser) => {
  state.APP_USERS.push(encodeUser(u));
  return u;
};
const supervisor = () => add(user({ role: "SUPER_ADMIN" }));
const actor = (u: AppUser) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "tempcontrol-oauth-"));
  process.env.PRIVATE_STORAGE_PATH = directory;
});
afterAll(async () => {
  if (
    path.dirname(directory) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith("tempcontrol-oauth-")
  )
    throw new Error("Unsafe test cleanup");
  await rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_COORDINATION_MODE = "single-host";
  process.env.INITIAL_SUPER_ADMIN_EMAIL = identity.email;
  ids = { APP_USERS: 0, APP_CONFIG: 1, AUDIT_LOG: 2, APP_USERS_LEGACY: 3 };
  state = {
    APP_USERS: [USER_HEADERS],
    APP_CONFIG: [["KEY", "VALUE"]],
    AUDIT_LOG: [["ID", "AT", "ACTOR", "ACTION", "ENTITY", "BEFORE", "AFTER"]],
    APP_USERS_LEGACY: [ARCHIVE_HEADERS],
  };
  mock.ids.mockImplementation(async () => ({ ...ids }));
  mock.ensure.mockImplementation(async () => ({ ...ids }));
  mock.rows.mockImplementation(async (name: string) =>
    structuredClone(state[name] || []),
  );
  mock.batch.mockImplementation(async (ops: Op[]) => {
    const next = structuredClone(state);
    const name = (id: number) => Object.keys(ids).find((k) => ids[k] === id)!;
    for (const op of ops) {
      if (op.addSheet) {
        ids[op.addSheet.properties.title] = op.addSheet.properties.sheetId;
        next[op.addSheet.properties.title] = [];
      }
      if (op.append)
        next[name(op.append.sheetId)].push(structuredClone(op.append.row));
      if (op.replace)
        next[name(op.replace.sheetId)][op.replace.index] = structuredClone(
          op.replace.row,
        );
      if (op.updateCells)
        next[name(op.updateCells.range.sheetId)] = op.updateCells.rows.map(
          (r) =>
            r.values.map(
              (c) =>
                c.userEnteredValue.numberValue ??
                c.userEnteredValue.stringValue ??
                "",
            ),
        );
    }
    state = next;
  });
});
describe("Google identity and user service", () => {
  it("does not merge an existing Google subject into a different invitation after an email change", async () => {
    add(user({ googleId: identity.googleId, email: "old@gmail.com" }));
    add(user({ googleId: "", email: identity.email, role: "SUPER_ADMIN" }));
    await expect(syncGoogleIdentity(identity)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      state.APP_USERS.filter((r) => r[1] === identity.googleId),
    ).toHaveLength(1);
    expect(mock.batch).not.toHaveBeenCalled();
  });
  it("verifies email_verified and Google subject, never accepts a fabricated profile", () => {
    expect(() =>
      verifiedGoogleProfile(
        { ...identity, sub: "sub", email_verified: false },
        "sub",
      ),
    ).toThrow();
    expect(() =>
      verifiedGoogleProfile(
        {
          sub: "sub",
          email: "operator@gmail.com",
          name: "A",
          email_verified: true,
        },
        "other",
      ),
    ).toThrow();
    expect(
      verifiedGoogleProfile(
        {
          sub: "sub",
          email: "operator@gmail.com",
          name: "A",
          email_verified: true,
        },
        "sub",
      ).authoritativeEmail,
    ).toBe(true);
  });
  it("unknown login does not auto-register or grant access", async () => {
    expect(await syncGoogleIdentity(identity)).toBeNull();
    expect(state.APP_USERS).toHaveLength(1);
  });
  it("new registration is PETUGAS/PENDING even when bootstrap email matches", async () => {
    const u = await syncGoogleIdentity(identity, true);
    expect(u).toMatchObject({
      role: "PETUGAS",
      status: "PENDING",
      googleId: identity.googleId,
    });
    expect(state.APP_CONFIG).toHaveLength(1);
  });
  it("concurrent duplicate registration creates only one Google identity under persistent filesystem lock", async () => {
    const result = await Promise.all(
      Array.from({ length: 5 }, () => syncGoogleIdentity(identity, true)),
    );
    expect(new Set(result.map((u) => u!.id)).size).toBe(1);
    expect(state.APP_USERS).toHaveLength(2);
    expect(
      state.AUDIT_LOG.filter((r) => r[3] === "REGISTER_USER"),
    ).toHaveLength(1);
  });
  it("repeated Google login retains app user ID and updates last login without duplication", async () => {
    const u = add(user({ googleId: identity.googleId, email: identity.email }));
    const found = await syncGoogleIdentity({ ...identity, name: "New name" });
    expect(found!.id).toBe(u.id);
    expect(found!.name).toBe("New name");
    expect(found!.lastLogin).not.toBe(u.lastLogin);
    expect(state.APP_USERS).toHaveLength(2);
  });
  it("invitation has no fake Google ID and binds verified subject while preserving assigned role", async () => {
    const admin = supervisor();
    const u = await inviteUser(
      {
        email: identity.email,
        role: "SUPERVISOR",
        status: "ACTIVE",
        notes: "Fixture invitation",
      },
      actor(admin),
    );
    expect(u.googleId).toBe("");
    expect(u.createdBy).toBe(admin.id);
    const bound = await syncGoogleIdentity(identity);
    expect(bound).toMatchObject({
      id: u.id,
      googleId: identity.googleId,
      role: "SUPERVISOR",
      status: "ACTIVE",
    });
  });
  it("never relinks an existing subject just because email matches", async () => {
    add(user({ email: identity.email, googleId: "different-google-id" }));
    await expect(syncGoogleIdentity(identity, true)).rejects.toMatchObject({
      status: 403,
    });
    expect(state.APP_USERS).toHaveLength(2);
  });
  it("does not email-link non-authoritative third-party Google identities to an invitation", async () => {
    add(user({ email: identity.email, googleId: "" }));
    await expect(
      syncGoogleIdentity({ ...identity, authoritativeEmail: false }, true),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(["REJECTED", "SUSPENDED"] as const)(
    "%s cannot re-register to bypass restrictions",
    async (status) => {
      const u = add(
        user({ googleId: identity.googleId, email: identity.email, status }),
      );
      await expect(syncGoogleIdentity(identity, true)).rejects.toMatchObject({
        status: 403,
      });
      expect((await syncGoogleIdentity(identity))!.status).toBe(status);
      expect(state.APP_USERS).toHaveLength(2);
      expect(decodeUser(state.APP_USERS[1]).lastLogin).toBe(u.lastLogin);
    },
  );
  it("Sheets failures fail closed without reporting registration success", async () => {
    mock.rows.mockRejectedValue(new Error("API unavailable"));
    await expect(syncGoogleIdentity(identity, true)).rejects.toThrow(
      "API unavailable",
    );
    expect(mock.batch).not.toHaveBeenCalled();
  });
  it("refuses user mutations without explicit single-host coordination mode", async () => {
    process.env.AUTH_COORDINATION_MODE = "multi-host";
    await expect(syncGoogleIdentity(identity, true)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("detects duplicate IDs/emails rather than selecting an arbitrary privileged row", async () => {
    const u = add(user());
    add({ ...u, id: crypto.randomUUID() });
    await expect(userTable()).rejects.toMatchObject({ status: 503 });
  });
});
describe("Administrative consistency", () => {
  it("an unbound Super Admin invitation cannot replace the last usable Super Admin", async () => {
    const admin = supervisor();
    add(user({ role: "SUPER_ADMIN", googleId: "", lastLogin: "" }));
    await expect(
      changeUser(
        admin.id,
        { status: "SUSPENDED" },
        admin.updatedAt,
        actor(admin),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("allows the owner to bootstrap a verified migrated ACTIVE administrator once", async () => {
    const target = add(
      user({
        role: "ADMIN",
        googleId: identity.googleId,
        email: identity.email,
      }),
    );
    await bootstrapSuperAdmin(target.id);
    expect(decodeUser(state.APP_USERS[1]).role).toBe("SUPER_ADMIN");
  });
  it("only a live Super Admin may manage accounts, including direct service invocation", async () => {
    const petugas = add(user());
    await expect(
      inviteUser(
        {
          email: identity.email,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
          notes: "",
        },
        actor(petugas),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("approves pending registration and records approver and audit", async () => {
    const admin = supervisor(),
      pending = add(user({ status: "PENDING" }));
    const next = await changeUser(
      pending.id,
      { status: "ACTIVE" },
      pending.updatedAt,
      actor(admin),
    );
    expect(next.status).toBe("ACTIVE");
    expect(next.approvedBy).toBe(admin.id);
    expect(state.AUDIT_LOG.at(-1)![3]).toBe("MANAGE_USER");
  });
  it("rejects stale version during role changes", async () => {
    const admin = supervisor(),
      target = add(user());
    await expect(
      changeUser(target.id, { role: "ADMIN" }, "stale", actor(admin)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("protects the final active Super Admin against suspension and demotion", async () => {
    const admin = supervisor();
    await expect(
      changeUser(
        admin.id,
        { status: "SUSPENDED" },
        admin.updatedAt,
        actor(admin),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      changeUser(admin.id, { role: "ADMIN" }, admin.updatedAt, actor(admin)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("concurrent Super Admin demotions cannot remove the last active Super Admin", async () => {
    const a = supervisor(),
      b = supervisor();
    const results = await Promise.allSettled([
      changeUser(a.id, { role: "ADMIN" }, a.updatedAt, actor(a)),
      changeUser(b.id, { role: "ADMIN" }, b.updatedAt, actor(b)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await userTable()).users.filter(
        (u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE",
      ),
    ).toHaveLength(1);
  });
  it("concurrent manual bootstraps commit one promotion and one persistent completion marker", async () => {
    const target = add(
      user({
        googleId: identity.googleId,
        email: identity.email,
        status: "PENDING",
      }),
    );
    const results = await Promise.allSettled([
      bootstrapSuperAdmin(target.id),
      bootstrapSuperAdmin(target.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      state.APP_CONFIG.filter(
        (r) => r[0] === "SUPER_ADMIN_BOOTSTRAP_COMPLETED",
      ),
    ).toHaveLength(1);
    expect(
      state.AUDIT_LOG.filter((r) => r[3] === "BOOTSTRAP_SUPER_ADMIN"),
    ).toHaveLength(1);
    state.APP_USERS[1][5] = "PETUGAS";
    await expect(bootstrapSuperAdmin(target.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("never bootstraps an unverified invitation even if the email matches", async () => {
    const target = add(
      user({
        googleId: "",
        email: identity.email,
        lastLogin: "",
        status: "PENDING",
      }),
    );
    await expect(bootstrapSuperAdmin(target.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("migrates legacy users preserving IDs, roles and password archive without touching monitoring", async () => {
    const id = crypto.randomUUID();
    state.APP_USERS = [
      LEGACY_HEADERS,
      [id, identity.email, "Legacy Admin", "bcrypt-hash", "ADMIN", true],
    ];
    state["Suhu Chiller"] = [["PRESERVE"], ["existing-record"]];
    const before = structuredClone(state["Suhu Chiller"]);
    await migrateUsers();
    const migrated = decodeUser(state.APP_USERS[1]);
    expect(migrated).toMatchObject({
      id,
      role: "ADMIN",
      status: "ACTIVE",
      googleId: "",
    });
    expect(state.APP_USERS_LEGACY[1][3]).toBe("bcrypt-hash");
    expect((await legacyAccount(identity.email))!.hash).toBe("bcrypt-hash");
    await syncGoogleIdentity(identity);
    expect(await legacyAccount(identity.email)).toBeNull();
    expect(await legacyActor(id)).toBeNull();
    expect(state["Suhu Chiller"]).toEqual(before);
  });
  it("unknown legacy schema is not overwritten", async () => {
    state.APP_USERS = [["UNRECOGNIZED"], ["preserve"]];
    await expect(migrateUsers()).rejects.toMatchObject({ status: 409 });
    expect(state.APP_USERS).toEqual([["UNRECOGNIZED"], ["preserve"]]);
  });
});
