import "next-auth";
import type { Role } from "@/lib/domain";
import type { AccountStatus } from "@/lib/users";
declare module "next-auth" {
  interface User {
    role?: Role;
    status?: AccountStatus;
    googleId?: string;
    googleVerified?: boolean;
  }
  interface Session {
    user: {
      id: string;
      googleId: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      picture: string;
      role: Role | null;
      status: AccountStatus;
      googleVerified: boolean;
      authoritativeEmail: boolean;
      provider: "google" | "credentials";
    };
  }
}
