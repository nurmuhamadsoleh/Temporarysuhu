import { z } from "zod";
import { roles, type Role } from "./domain";
export const userStatuses = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
] as const;
export type UserStatus = (typeof userStatuses)[number];
export type AccountStatus = UserStatus | "UNREGISTERED";
export const USER_HEADERS = [
  "USER ID",
  "GOOGLE ID",
  "FULL NAME",
  "EMAIL",
  "PROFILE PICTURE",
  "ROLE",
  "STATUS",
  "REGISTERED AT",
  "APPROVED AT",
  "APPROVED BY",
  "LAST LOGIN",
  "UPDATED AT",
  "CREATED BY",
  "UPDATED BY",
];
export const LEGACY_HEADERS = [
  "ID",
  "EMAIL",
  "NAME",
  "PASSWORD HASH",
  "ROLE",
  "ACTIVE",
];
export const ARCHIVE_HEADERS = [...LEGACY_HEADERS, "MIGRATED AT"];
export type AppUser = {
  id: string;
  googleId: string;
  name: string;
  email: string;
  picture: string;
  role: Role;
  status: UserStatus;
  registeredAt: string;
  approvedAt: string;
  approvedBy: string;
  lastLogin: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const inviteSchema = z
  .object({
    email: emailSchema,
    role: z.enum(roles),
    status: z.enum(userStatuses),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export const roleSchema = z
  .object({
    role: z.enum(roles),
    version: z.string().min(1),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export const statusSchema = z
  .object({
    status: z.enum(userStatuses),
    version: z.string().min(1),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export const profileSchema = z
  .object({
    name: z.string().min(1).max(150),
    version: z.string().min(1),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export function encodeUser(u: AppUser) {
  return [
    u.id,
    u.googleId,
    u.name,
    u.email,
    u.picture,
    u.role,
    u.status,
    u.registeredAt,
    u.approvedAt,
    u.approvedBy,
    u.lastLogin,
    u.updatedAt,
    u.createdBy,
    u.updatedBy,
  ];
}
export function decodeUser(r: unknown[]): AppUser {
  return {
    id: String(r[0] || ""),
    googleId: String(r[1] || ""),
    name: String(r[2] || ""),
    email: String(r[3] || ""),
    picture: String(r[4] || ""),
    role: z.enum(roles).parse(r[5]),
    status: z.enum(userStatuses).parse(r[6]),
    registeredAt: String(r[7] || ""),
    approvedAt: String(r[8] || ""),
    approvedBy: String(r[9] || ""),
    lastLogin: String(r[10] || ""),
    updatedAt: String(r[11] || ""),
    createdBy: String(r[12] || ""),
    updatedBy: String(r[13] || ""),
  };
}
/** Allow only Google's image host; never render arbitrary profile URLs from Sheets. */
export function safePicture(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" &&
      /(^|\.)googleusercontent\.com$/.test(url.hostname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export type GoogleIdentity = {
  googleId: string;
  email: string;
  name: string;
  picture: string;
  authoritativeEmail: boolean;
};
export function verifiedGoogleProfile(
  profile: unknown,
  providerAccountId: string,
): GoogleIdentity {
  const p = z
    .object({
      sub: z.string().min(1).max(255),
      email: emailSchema,
      email_verified: z.literal(true),
      name: z.string().min(1).max(150),
      picture: z.string().optional(),
      hd: z.string().optional(),
    })
    .parse(profile);
  if (p.sub !== providerAccountId) throw new Error("Invalid Google identity");
  return {
    googleId: p.sub,
    email: p.email,
    name: p.name,
    picture: safePicture(p.picture),
    authoritativeEmail:
      p.email.endsWith("@gmail.com") ||
      Boolean(p.hd && p.email.endsWith(`@${p.hd.toLowerCase()}`)),
  };
}
