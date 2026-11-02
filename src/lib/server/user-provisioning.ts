import "server-only";
import { z } from "zod";
import { roles, type Actor } from "@/lib/domain";
import {
  USER_HEADERS,
  LEGACY_HEADERS,
  ARCHIVE_HEADERS,
  encodeUser,
  type AppUser,
} from "@/lib/users";
import {
  sheetIds,
  rows,
  batch,
  cells,
  append,
  replace,
  audit,
  ensureSheetHeaders,
} from "./sheets";
import { schemaMatches, requireCoordination, userTable } from "./user-service";
import { locked } from "./storage";
import { AppError } from "./errors";
const owner: Actor = {
  id: "owner-cli",
  name: "Application owner (CLI)",
  email: "",
  role: "SUPER_ADMIN",
};
/** Owner runs offline: archive hashes and migrate users in ONE Sheets batch; no monitoring rows are touched. */
export async function migrateUsers() {
  requireCoordination();
  return locked(async () => {
    const ids = await sheetIds();
    if (ids.APP_USERS === undefined) {
      await ensureSheetHeaders(["APP_USERS", "APP_CONFIG", "AUDIT_LOG"]);
      return { migrated: 0, legacyUnbound: 0 };
    }
    const table = await rows("APP_USERS");
    if (schemaMatches(table[0] || [], USER_HEADERS)) {
      const { users } = await userTable();
      return {
        migrated: 0,
        legacyUnbound: users.filter((u) => !u.googleId).length,
      };
    }
    if (!schemaMatches(table[0] || [], LEGACY_HEADERS))
      throw new AppError(
        409,
        "Header pengguna tidak dikenal. Data tidak diubah.",
      );
    if (table.some((r) => r.slice(6).some((v) => v !== "")))
      throw new AppError(
        409,
        "Kolom tambahan legacy memerlukan migrasi manual",
      );
    const now = new Date().toISOString(),
      old = table.slice(1).filter((r) => r[0]),
      seen = new Set<string>(),
      emails = new Set<string>();
    const users = old.map((r) => {
      const id = z.uuid().parse(r[0]),
        email = z.email().parse(String(r[1]).toLowerCase()),
        role = z.enum(roles).parse(r[4]);
      if (role === "SUPER_ADMIN" || seen.has(id) || emails.has(email))
        throw new AppError(
          409,
          "Role atau duplikasi legacy memerlukan pemeriksaan manual",
        );
      seen.add(id);
      emails.add(email);
      return {
        id,
        googleId: "",
        name: String(r[2]),
        email,
        picture: "",
        role,
        status: String(r[5]).toLowerCase() === "true" ? "ACTIVE" : "SUSPENDED",
        registeredAt: now,
        approvedAt: "",
        approvedBy: "",
        lastLogin: "",
        updatedAt: now,
        createdBy: "legacy-migration",
        updatedBy: "owner-cli",
      } as AppUser;
    });
    const missing = ["APP_USERS_LEGACY", "APP_CONFIG", "AUDIT_LOG"].filter(
      (n) => ids[n] === undefined,
    );
    let nextId = Math.max(0, ...Object.values(ids)) + 1;
    for (const name of missing) ids[name] = nextId++;
    if (!missing.includes("APP_USERS_LEGACY")) {
      const archive = await rows("APP_USERS_LEGACY");
      if (
        !schemaMatches(archive[0] || [], ARCHIVE_HEADERS) ||
        archive.slice(1).some((r) => r[0])
      )
        throw new AppError(
          409,
          "Arsip legacy sudah berisi data; tinjau sebelum migrasi",
        );
    }
    const requests = missing.map((title) => ({
      addSheet: { properties: { title, sheetId: ids[title] } },
    }));
    const header = (sheetId: number, data: unknown[][]) => ({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: data.length,
          startColumnIndex: 0,
          endColumnIndex: data[0].length,
        },
        rows: data.map((r) => ({ values: cells(r) })),
        fields: "userEnteredValue",
      },
    });
    await batch([
      ...requests,
      header(ids.APP_USERS_LEGACY, [
        ARCHIVE_HEADERS,
        ...old.map((r) => [
          ...Array.from({ length: 6 }, (_, i) => r[i] ?? ""),
          now,
        ]),
      ]),
      header(ids.APP_USERS, [USER_HEADERS, ...users.map(encodeUser)]),
      ...(missing.includes("APP_CONFIG")
        ? [header(ids.APP_CONFIG, [["KEY", "VALUE"]])]
        : []),
      ...(missing.includes("AUDIT_LOG")
        ? [
            header(ids.AUDIT_LOG, [
              [
                "ID",
                "AT",
                "ACTOR",
                "ACTION",
                "ENTITY",
                "BEFORE",
                "AFTER",
                "IDEMPOTENCY KEY",
                "REQUEST HASH",
              ],
            ]),
          ]
        : []),
      audit(
        ids,
        owner,
        "MIGRATE_USERS_V2",
        "APP_USERS",
        { count: old.length },
        { count: users.length, archive: "APP_USERS_LEGACY" },
      ),
    ]);
    return { migrated: users.length, legacyUnbound: users.length };
  });
}
/** No OAuth callback invokes this function. Completion marker and promotion commit atomically. */
export async function bootstrapSuperAdmin(userId: string) {
  requireCoordination();
  return locked(async () => {
    const expected = z
      .email()
      .parse(process.env.INITIAL_SUPER_ADMIN_EMAIL)
      .toLowerCase();
    const { table, users } = await userTable();
    const ids = await ensureSheetHeaders([
        "APP_USERS",
        "APP_CONFIG",
        "AUDIT_LOG",
      ]),
      configuration = await rows("APP_CONFIG");
    if (
      configuration.some((r) => r[0] === "SUPER_ADMIN_BOOTSTRAP_COMPLETED") ||
      users.some((u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE")
    )
      throw new AppError(
        409,
        "Bootstrap telah selesai atau Super Admin aktif sudah tersedia",
      );
    const user = users.find((u) => u.id === z.uuid().parse(userId));
    if (
      !user ||
      !user.googleId ||
      !user.lastLogin ||
      user.email.toLowerCase() !== expected ||
      !["PENDING", "ACTIVE"].includes(user.status)
    )
      throw new AppError(
        409,
        "Pilih akun PENDING/ACTIVE yang telah diverifikasi Google dan sesuai INITIAL_SUPER_ADMIN_EMAIL",
      );
    const now = new Date().toISOString(),
      updated: AppUser = {
        ...user,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        approvedAt: now,
        approvedBy: owner.id,
        updatedAt: now,
        updatedBy: owner.id,
      };
    await batch([
      replace(
        ids.APP_USERS,
        table.findIndex((r) => r[0] === user.id),
        encodeUser(updated),
      ),
      append(ids.APP_CONFIG, [
        "SUPER_ADMIN_BOOTSTRAP_COMPLETED",
        JSON.stringify({
          completedAt: now,
          userId: user.id,
          googleId: user.googleId,
        }),
      ]),
      audit(ids, owner, "BOOTSTRAP_SUPER_ADMIN", user.id, user, updated),
    ]);
    return { id: updated.id, email: updated.email };
  });
}
