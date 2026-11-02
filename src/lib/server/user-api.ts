import { z } from "zod";
import { requireActor, requireGoogleIdentity, rateLimit } from "./auth";
import { ok, fail, originCheck, AppError } from "./errors";
import { readJson } from "./body";
import {
  inviteSchema,
  roleSchema,
  statusSchema,
  profileSchema,
} from "@/lib/users";
import {
  userTable,
  findUser,
  syncGoogleIdentity,
  inviteUser,
  changeUser,
} from "./user-service";
import { rows } from "./sheets";
import { roles } from "@/lib/domain";
import { userStatuses } from "@/lib/users";
export type UserContext = { params: Promise<{ id: string }> };
export async function listUsers(req: Request, pending = false) {
  try {
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit(`users-read:${actor.id}`, 180);
    const p = new URL(req.url).searchParams;
    z.object({
      q: z.string().max(200).optional(),
      role: z.enum(roles).or(z.literal("")).optional(),
      status: z.enum(userStatuses).or(z.literal("")).optional(),
    })
      .strict()
      .parse(Object.fromEntries(p));
    const users = (await userTable()).users.filter(
      (u) =>
        (!pending || u.status === "PENDING") &&
        (!p.get("role") || u.role === p.get("role")) &&
        (!p.get("status") || u.status === p.get("status")) &&
        (!p.get("q") ||
          `${u.name} ${u.email}`
            .toLowerCase()
            .includes(p.get("q")!.toLowerCase())),
    );
    return ok(users);
  } catch (e) {
    return fail(e);
  }
}
export async function registerUser(req: Request) {
  try {
    originCheck(req);
    const identity = await requireGoogleIdentity();
    await rateLimit(`register:${identity.googleId}`, 12);
    z.object({})
      .strict()
      .parse(await readJson(req));
    const user = await syncGoogleIdentity(identity, true);
    return ok(user, "Status pendaftaran terverifikasi");
  } catch (e) {
    return fail(e);
  }
}
export async function invite(req: Request) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit(`users-write:${actor.id}`, 60);
    return ok(
      await inviteUser(inviteSchema.parse(await readJson(req)), actor),
      "Undangan dibuat",
      201,
    );
  } catch (e) {
    return fail(e);
  }
}
export async function getUser(_: Request, c: UserContext) {
  try {
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit(`users-read:${actor.id}`, 180);
    const id = z.uuid().parse((await c.params).id),
      user = await findUser(id);
    if (!user) throw new AppError(404, "Pengguna tidak ditemukan");
    const activity = (await rows("AUDIT_LOG"))
      .slice(1)
      .filter((r) => r[2] === id || r[4] === id)
      .slice(-100)
      .reverse();
    return ok({ user, activity });
  } catch (e) {
    return fail(e);
  }
}
export async function mutateUser(
  req: Request,
  c: UserContext,
  action: "role" | "status" | "profile" | "approve" | "reject",
) {
  try {
    originCheck(req);
    const actor = await requireActor(["SUPER_ADMIN"]);
    await rateLimit(`users-write:${actor.id}`, 60);
    const id = z.uuid().parse((await c.params).id),
      body = await readJson(req);
    if (action === "role") {
      const p = roleSchema.parse(body);
      return ok(
        await changeUser(id, { role: p.role }, p.version, actor, p.notes),
      );
    }
    if (action === "profile") {
      const p = profileSchema.parse(body);
      return ok(
        await changeUser(id, { name: p.name }, p.version, actor, p.notes),
      );
    }
    if (action === "status") {
      const p = statusSchema.parse(body);
      return ok(
        await changeUser(id, { status: p.status }, p.version, actor, p.notes),
      );
    }
    const p = z
      .object({
        version: z.string().min(1),
        notes: z.string().max(1000).default(""),
      })
      .strict()
      .parse(body);
    const previous = await findUser(id);
    if (!previous || previous.status !== "PENDING")
      throw new AppError(
        409,
        "Persetujuan atau penolakan hanya berlaku untuk registrasi PENDING",
      );
    return ok(
      await changeUser(
        id,
        { status: action === "approve" ? "ACTIVE" : "REJECTED" },
        p.version,
        actor,
        p.notes,
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
