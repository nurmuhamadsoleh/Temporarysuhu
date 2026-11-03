import "server-only";
import { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { z } from "zod";
import { AppError } from "./errors";
import { locked, getFile, putFile } from "./storage";
import { roles, type Actor } from "@/lib/domain";
import { verifiedGoogleProfile, type GoogleIdentity } from "@/lib/users";
import { safeLog } from "./safe-log";
import { parseBooleanEnv, authOrigin } from "./runtime-config.mjs";
import {
  findUser,
  findGoogleUser,
  syncGoogleIdentity,
  legacyAccount,
  legacyActor,
} from "./user-service";
if (!process.env.NEXTAUTH_URL && process.env.AUTH_URL)
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
export async function rateLimit(key: string, max = 10, windowMs = 900000) {
  await locked(async () => {
    let state: Record<string, { n: number; at: number }> = {};
    try {
      state = JSON.parse((await getFile("rate-limits.json")).toString());
    } catch (error) {
      if ((error as { code?: string })?.code !== "ENOENT")
        throw new AppError(
          503,
          "Penyimpanan pembatasan akses tidak tersedia. Hubungi administrator.",
        );
    }
    const now = Date.now();
    state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => v.at > now - windowMs),
    );
    const bucket = state[key] || { n: 0, at: now };
    if (bucket.n >= max)
      throw new AppError(429, "Terlalu banyak percobaan. Coba lagi nanti.");
    bucket.n++;
    state[key] = bucket;
    await putFile("rate-limits.json", JSON.stringify(state));
  });
}
export const legacyEnabled = () =>
  parseBooleanEnv(process.env.LEGACY_CREDENTIALS_ENABLED, false);
export const googleConfigured = () =>
  Boolean(
    (process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET),
  );
export const authOptions: NextAuthOptions = {
  useSecureCookies:
    process.env.NODE_ENV === "production" ||
    Boolean(
      (process.env.AUTH_URL || process.env.NEXTAUTH_URL)?.startsWith(
        "https://",
      ),
    ),
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/auth/error" },
  logger: {
    error(code) {
      safeLog("auth_error", code);
    },
    warn(code) {
      safeLog("auth_warning", code);
    },
    debug() {},
  },
  providers: [
    Google({
      clientId:
        process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || "",
      clientSecret:
        process.env.AUTH_GOOGLE_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET ||
        "",
      authorization: {
        params: { scope: "openid email profile", prompt: "select_account" },
      },
      checks: ["pkce", "state", "nonce"],
    }),
    ...(!legacyEnabled()
      ? []
      : [
          Credentials({
            name: "Akun lama (migrasi)",
            credentials: {
              email: { type: "email" },
              password: { type: "password" },
            },
            async authorize(credentials) {
              const input = z
                .object({
                  email: z
                    .email()
                    .max(254)
                    .transform((v) => v.toLowerCase()),
                  password: z.string().min(1).max(72),
                })
                .safeParse(credentials);
              if (!input.success || Buffer.byteLength(input.data.password) > 72)
                return null;
              await rateLimit(`legacy:${input.data.email}`);
              await rateLimit("login-global", 100);
              const account = await legacyAccount(input.data.email);
              const match = await compare(
                input.data.password,
                account?.hash ||
                  "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
              );
              if (
                !account?.active ||
                account.role === "SUPER_ADMIN" ||
                !match ||
                !roles.includes(account.role as Actor["role"])
              )
                return null;
              return {
                id: account.id,
                email: account.email,
                name: account.name,
                role: account.role as Actor["role"],
                status: "ACTIVE" as const,
                googleId: "",
                googleVerified: false,
              };
            },
          }),
        ]),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") {
        try {
          verifiedGoogleProfile(profile, account.providerAccountId);
          safeLog("auth_stage", "GOOGLE_PROFILE_VERIFIED");
          return true;
        } catch {
          safeLog("auth_error", "GOOGLE_PROFILE_REJECTED");
          return false;
        }
      }
      return account?.provider === "credentials" && legacyEnabled();
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const identity = verifiedGoogleProfile(
          profile,
          account.providerAccountId,
        );
        try {
          await rateLimit(`oauth:${identity.googleId}`, 40);
        } catch (error) {
          safeLog(
            "auth_error",
            error instanceof AppError && error.status === 429
              ? "OAUTH_RATE_LIMITED"
              : "OAUTH_STORAGE_UNAVAILABLE",
          );
          throw error;
        }
        let found: Awaited<ReturnType<typeof syncGoogleIdentity>>;
        try {
          found = await syncGoogleIdentity(identity);
        } catch (error) {
          safeLog(
            "auth_error",
            error instanceof AppError && error.status === 403
              ? "OAUTH_ACCOUNT_DENIED"
              : "OAUTH_USER_STORE_UNAVAILABLE",
          );
          throw error;
        }
        safeLog("auth_stage", `OAUTH_USER_${found?.status || "UNREGISTERED"}`);
        token.id = found?.id || "";
        token.googleId = identity.googleId;
        token.googleVerified = true;
        token.authoritativeEmail = identity.authoritativeEmail;
        token.name = found?.name || identity.name;
        token.email = identity.email;
        token.picture = identity.picture;
        token.provider = "google";
      } else if (account?.provider === "credentials" && user) {
        token.id = user.id;
        token.googleId = "";
        token.googleVerified = false;
        token.provider = "credentials";
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (
        token.provider === "google" &&
        token.googleVerified === true &&
        typeof token.googleId === "string"
      ) {
        let u: Awaited<ReturnType<typeof findUser>>;
        try {
          u = token.id
            ? await findUser(String(token.id))
            : await findGoogleUser(token.googleId);
        } catch (error) {
          safeLog("auth_error", "SESSION_USER_STORE_UNAVAILABLE");
          throw error;
        }
        const valid = u?.googleId === token.googleId ? u : null;
        session.user = {
          id: valid?.id || "",
          googleId: token.googleId,
          name: valid?.name || token.name,
          email: valid?.email || token.email,
          image: valid?.picture || token.picture,
          picture: valid?.picture || token.picture || "",
          role: valid?.role || null,
          status: valid?.status || "UNREGISTERED",
          googleVerified: true,
          authoritativeEmail: token.authoritativeEmail === true,
          provider: "google",
        };
      } else {
        const u = legacyEnabled()
          ? await legacyActor(String(token.id || ""))
          : null;
        session.user = {
          id: u?.id || "",
          googleId: "",
          name: u?.name || token.name,
          email: u?.email || token.email,
          image: null,
          picture: "",
          role: u?.role || null,
          status: u ? "ACTIVE" : "SUSPENDED",
          googleVerified: false,
          authoritativeEmail: false,
          provider: "credentials",
        };
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      const origin = process.env.NODE_ENV === "production" ? authOrigin() : baseUrl;
      if (url.startsWith("/") && !url.startsWith("//"))
        return `${origin}${url}`;
      try {
        if (new URL(url).origin === origin) return url;
      } catch {}
      return `${origin}/auth/continue`;
    },
  },
};
export async function requireGoogleIdentity(): Promise<GoogleIdentity> {
  const session = await getServerSession(authOptions),
    u = session?.user;
  if (
    !u ||
    u.provider !== "google" ||
    !u.googleVerified ||
    !u.googleId ||
    !u.email ||
    !u.name
  )
    throw new AppError(401, "Verifikasi akun Google diperlukan");
  return {
    googleId: u.googleId,
    email: u.email,
    name: u.name,
    picture: u.picture || "",
    authoritativeEmail: u.authoritativeEmail,
  };
}
export async function requireActor(
  allowed: Actor["role"][] = [...roles],
): Promise<Actor> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new AppError(401, "Silakan login");
  let actor: Actor | null = null;
  if (session.user.provider === "google" && session.user.googleVerified) {
    const u = await findUser(session.user.id);
    if (u?.googleId === session.user.googleId && u.status === "ACTIVE")
      actor = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        googleId: u.googleId,
        picture: u.picture,
      };
  } else if (legacyEnabled() && session.user.provider === "credentials") {
    actor = await legacyActor(session.user.id);
  }
  if (!actor)
    throw new AppError(403, "Akun belum aktif atau akses telah dicabut");
  if (actor.role !== "SUPER_ADMIN" && !allowed.includes(actor.role))
    throw new AppError(403, "Akses tidak diizinkan");
  return actor;
}
