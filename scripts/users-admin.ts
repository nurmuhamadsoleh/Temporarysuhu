import { ensureSheetHeaders, rows, sheetIds } from "../src/lib/server/sheets";
import { locked } from "../src/lib/server/storage";
import {
  migrateUsers,
  bootstrapSuperAdmin,
} from "../src/lib/server/user-provisioning";
import { userTable, schemaMatches } from "../src/lib/server/user-service";
import { LEGACY_HEADERS } from "../src/lib/users";
const action = process.argv[2];
async function main() {
  if (action === "init") {
    await locked(() =>
      ensureSheetHeaders([
        "APP_USERS",
        "APP_CONFIG",
        "AUDIT_LOG",
        "SIGNATURE_METADATA",
        "REPORTS",
      ]),
    );
    console.log("Schema tervalidasi. Untuk legacy, gunakan perintah migrate.");
    return;
  }
  if (action === "init-app") {
    await locked(() => ensureSheetHeaders());
    console.log("Schema aplikasi tervalidasi; data existing dipertahankan.");
    return;
  }
  if (action === "migrate") {
    console.log(await migrateUsers());
    return;
  }
  if (action === "audit") {
    const ids = await sheetIds();
    if (ids.APP_USERS === undefined) {
      console.log({ schema: "absent", count: 0, sheets: Object.keys(ids) });
      return;
    }
    const table = await rows("APP_USERS");
    if (process.argv.includes("--summary")) {
      if (schemaMatches(table[0] || [], LEGACY_HEADERS)) {
        const records = table.slice(1).filter((r) => r[0]);
        console.log({
          schema: "legacy",
          count: records.length,
          activeAdmins: records.filter(
            (r) => r[4] === "ADMIN" && String(r[5]).toLowerCase() === "true",
          ).length,
        });
      } else {
        const { users } = await userTable();
        console.log({
          schema: "google-v2",
          count: users.length,
          unbound: users.filter((u) => !u.googleId).length,
          activeSuperAdmins: users.filter(
            (u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE",
          ).length,
        });
      }
      return;
    }
    if (schemaMatches(table[0] || [], LEGACY_HEADERS)) {
      console.table(
        table
          .slice(1)
          .filter((r) => r[0])
          .map((r) => ({
            id: r[0],
            email: r[1],
            role: r[4],
            active: r[5],
            migration: "NOT MIGRATED",
          })),
      );
      return;
    }
    const { users } = await userTable();
    console.table(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        googleLinked: Boolean(u.googleId),
      })),
    );
    console.log(
      "Jangan nonaktifkan Credentials sampai semua akun penting telah ditautkan ke Google.",
    );
    return;
  }
  if (action === "bootstrap") {
    if (process.argv[3] !== "--confirm")
      throw new Error(
        "Gunakan bootstrap --confirm USER_ID setelah meninjau hasil audit",
      );
    console.log(await bootstrapSuperAdmin(process.argv[4] || ""));
    return;
  }
  throw new Error(
    "Perintah: init | migrate | audit | bootstrap --confirm USER_ID",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Provisioning gagal");
  process.exitCode = 1;
});
