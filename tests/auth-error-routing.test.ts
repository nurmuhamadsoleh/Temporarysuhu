import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("lucide-react", () => ({ ShieldCheck: () => null }));
vi.mock("@/lib/server/auth", () => ({
  authOptions: {},
  googleConfigured: () => true,
  legacyEnabled: () => false,
}));
vi.mock("@/components/auth/AuthFrame", () => ({ AuthFrame: () => null }));
vi.mock("@/components/auth/GoogleButton", () => ({ GoogleButton: () => null }));
import Login from "@/app/login/page";
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockRejectedValue(new Error("APP_USERS unavailable"));
});
it.each(["OAuthCallback", "OAuthSignin", "AccessDenied"])(
  "routes %s to safe feedback before any session/database lookup",
  async (error) => {
    await expect(
      Login({ searchParams: Promise.resolve({ error }) }),
    ).rejects.toThrow(`REDIRECT:/auth/error?error=${error}`);
    expect(m.session).not.toHaveBeenCalled();
  },
);
it("normalizes an untrusted error parameter without copying it into a redirect", async () => {
  await expect(
    Login({ searchParams: Promise.resolve({ error: "TOKEN-DO-NOT-ECHO" }) }),
  ).rejects.toThrow("REDIRECT:/auth/error?error=Default");
  expect(m.session).not.toHaveBeenCalled();
});
