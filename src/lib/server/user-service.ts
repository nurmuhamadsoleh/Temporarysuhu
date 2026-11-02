import "server-only";
import {
  USER_HEADERS,
  LEGACY_HEADERS,
  decodeUser,
  encodeUser,
  type AppUser,
  type GoogleIdentity,
} from "@/lib/users";
import type { Actor } from "@/lib/domain";
import {
  rows,
  ensureSheetHeaders,
  batch,
  append,
  replace,
  audit,
} from "./sheets";
import { AppError } from "./errors";
import { locked } from "./storage";
export const schemaMatches = (a: unknown[], b: string[]) =>
  b.every((v, i) => a[i] === v);
export function requireCoordination() {
  if (process.env.AUTH_COORDINATION_MODE !== "single-host")
    throw new AppError(
      503,
      "Konfigurasi koordinasi autentikasi belum tersedia. Hubungi pemilik aplikasi.",
    );
}
export async function userTable() {
  const table = await rows("APP_USERS");
  if (!schemaMatches(table[0] || [], USER_HEADERS))
    throw new AppError(
      503,
      "Schema pengguna perlu dimigrasikan oleh pemilik aplikasi. Akun lama dipertahankan.",
    );
  const users = table
    .slice(1)
    .filter((r) => r[0])
    .map(decodeUser);
  const ids = new Set<string>(),
    google = new Set<string>(),
    emails = new Set<string>();
  for (const u of users) {
    const email = u.email.toLowerCase();
    if (
      ids.has(u.id) ||
      (u.googleId && google.has(u.googleId)) ||
      emails.has(email)
    )
      throw new AppError(
        503,
        "Integritas data pengguna memerlukan pemeriksaan administrator",
      );
    ids.add(u.id);
    if (u.googleId) google.add(u.googleId);
    emails.add(email);
  }
  return { table, users };
}
export async function findUser(id: string) {
  return (await userTable()).users.find((u) => u.id === id);
}
export async function findGoogleUser(googleId: string) {
  return (await userTable()).users.find((u) => u.googleId === googleId);
}
function actorFor(u: AppUser): Actor {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
/** Mutations are serialized across processes on one persistent host. Never deploy on independent volumes. */
export async function syncGoogleIdentity(
  identity: GoogleIdentity,
  register = false,
) {
  requireCoordination();
  return locked(async () => {
    const { table, users } = await userTable();
    let u = users.find((u) => u.googleId === identity.googleId);
    const emailOwner = users.find(
      (u) => u.email.toLowerCase() === identity.email,
    );
    if (emailOwner && emailOwner.id !== u?.id) {
      if (u || emailOwner.googleId || !identity.authoritativeEmail)
        throw new AppError(
          403,
          "Akun tidak dapat diproses. Hubungi administrator.",
        );
      u = emailOwner;
    }
    if (!u && !register) return null;
    if (register && u && ["REJECTED", "SUSPENDED"].includes(u.status))
      throw new AppError(
        403,
        "Akses akun tidak tersedia. Hubungi administrator.",
      );
    const ids = await ensureSheetHeaders([
        "APP_USERS",
        "APP_CONFIG",
        "AUDIT_LOG",
      ]),
      now = new Date().toISOString();
    if (!u) {
      const created: AppUser = {
        id: crypto.randomUUID(),
        googleId: identity.googleId,
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        role: "PETUGAS",
        status: "PENDING",
        registeredAt: now,
        approvedAt: "",
        approvedBy: "",
        lastLogin: now,
        updatedAt: now,
        createdBy: `google:${identity.googleId}`,
        updatedBy: `google:${identity.googleId}`,
      };
      await batch([
        append(ids.APP_USERS, encodeUser(created)),
        audit(
          ids,
          actorFor(created),
          "REGISTER_USER",
          created.id,
          null,
          created,
        ),
      ]);
      const read = await findGoogleUser(identity.googleId);
      if (!read)
        throw new AppError(
          503,
          "Pendaftaran belum dapat diverifikasi. Silakan coba lagi.",
        );
      return read;
    }
    const updated = {
      ...u,
      googleId: identity.googleId,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
      lastLogin: ["REJECTED", "SUSPENDED"].includes(u.status)
        ? u.lastLogin
        : now,
      updatedAt: now,
      updatedBy: u.id,
    };
    await batch([
      replace(
        ids.APP_USERS,
        table.findIndex((r) => r[0] === u.id),
        encodeUser(updated),
      ),
      audit(
        ids,
        actorFor(updated),
        ["REJECTED", "SUSPENDED"].includes(u.status)
          ? "GOOGLE_ACCESS_DENIED"
          : u.googleId
            ? "GOOGLE_LOGIN"
            : "BIND_GOOGLE_ID",
        u.id,
        u,
        updated,
      ),
    ]);
    return updated;
  });
}
export async function inviteUser(
  input: {
    email: string;
    role: AppUser["role"];
    status: AppUser["status"];
    notes: string;
  },
  actor: Actor,
) {
  requireCoordination();
  return locked(async () => {
    await assertSuperAdmin(actor.id);
    const { users } = await userTable();
    if (users.some((u) => u.email === input.email))
      throw new AppError(
        409,
        "Undangan tidak dapat dibuat. Periksa daftar pengguna.",
      );
    const now = new Date().toISOString(),
      user: AppUser = {
        id: crypto.randomUUID(),
        googleId: "",
        email: input.email,
        name: "Undangan belum ditautkan",
        picture: "",
        role: input.role,
        status: input.status,
        registeredAt: now,
        approvedAt: input.status === "ACTIVE" ? now : "",
        approvedBy: input.status === "ACTIVE" ? actor.id : "",
        lastLogin: "",
        updatedAt: now,
        createdBy: actor.id,
        updatedBy: actor.id,
      };
    const ids = await ensureSheetHeaders([
      "APP_USERS",
      "APP_CONFIG",
      "AUDIT_LOG",
    ]);
    await batch([
      append(ids.APP_USERS, encodeUser(user)),
      audit(ids, actor, "INVITE_USER", user.id, null, {
        ...user,
        notes: input.notes,
      }),
    ]);
    return user;
  });
}
export async function assertSuperAdmin(id: string) {
  const actor = await findUser(id);
  if (
    !actor ||
    !actor.googleId ||
    actor.role !== "SUPER_ADMIN" ||
    actor.status !== "ACTIVE"
  )
    throw new AppError(403, "Akses tidak diizinkan");
  return actor;
}
export async function changeUser(
  id: string,
  patch: Partial<Pick<AppUser, "name" | "role" | "status">>,
  version: string,
  actor: Actor,
  notes = "",
) {
  requireCoordination();
  return locked(async () => {
    await assertSuperAdmin(actor.id);
    const { table, users } = await userTable(),
      old = users.find((u) => u.id === id);
    if (!old) throw new AppError(404, "Pengguna tidak ditemukan");
    if (old.updatedAt !== version)
      throw new AppError(
        409,
        "Data pengguna telah berubah. Refresh sebelum melanjutkan.",
      );
    const updated = {
      ...old,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
    };
    if (
      old.role === "SUPER_ADMIN" &&
      old.status === "ACTIVE" &&
      (updated.role !== "SUPER_ADMIN" || updated.status !== "ACTIVE") &&
      users.filter(
        (u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE" && u.googleId,
      ).length <= 1
    )
      throw new AppError(
        409,
        "Super Admin aktif terakhir tidak boleh diturunkan atau dinonaktifkan",
      );
    if (patch.status === "ACTIVE" && old.status !== "ACTIVE") {
      updated.approvedAt = updated.updatedAt;
      updated.approvedBy = actor.id;
    }
    const ids = await ensureSheetHeaders([
      "APP_USERS",
      "APP_CONFIG",
      "AUDIT_LOG",
    ]);
    await batch([
      replace(
        ids.APP_USERS,
        table.findIndex((r) => r[0] === id),
        encodeUser(updated),
      ),
      audit(ids, actor, "MANAGE_USER", id, old, { ...updated, notes }),
    ]);
    return updated;
  });
}
export async function legacyAccount(email: string) {
  const data = await rows("APP_USERS");
  if (schemaMatches(data[0] || [], LEGACY_HEADERS)) {
    const r = data.slice(1).find((r) => String(r[1]).toLowerCase() === email);
    return r
      ? {
          id: String(r[0]),
          email: String(r[1]),
          name: String(r[2]),
          hash: String(r[3]),
          role: r[4],
          active: String(r[5]).toLowerCase() === "true",
        }
      : null;
  }
  const u = (await userTable()).users.find(
    (u) => u.email === email && !u.googleId,
  );
  if (!u) return null;
  const all = (await import("./sheets")).sheetIds;
  const ids = await all();
  if (ids.APP_USERS_LEGACY === undefined) return null;
  const r = (await rows("APP_USERS_LEGACY"))
    .slice(1)
    .find((r) => r[0] === u.id);
  return r
    ? {
        id: u.id,
        email: u.email,
        name: u.name,
        hash: String(r[3]),
        role: u.role,
        active: u.status === "ACTIVE",
      }
    : null;
}
export async function legacyActor(id: string) {
  const data = await rows("APP_USERS");
  if (schemaMatches(data[0] || [], LEGACY_HEADERS)) {
    const r = data.slice(1).find((r) => r[0] === id);
    return r && r[4] !== "SUPER_ADMIN" && String(r[5]).toLowerCase() === "true"
      ? {
          id: String(r[0]),
          email: String(r[1]),
          name: String(r[2]),
          role: r[4] as Actor["role"],
        }
      : null;
  }
  const u = await findUser(id);
  return u && u.role !== "SUPER_ADMIN" && u.status === "ACTIVE" && !u.googleId
    ? actorFor(u)
    : null;
}
