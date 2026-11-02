import React from "react";
export const usePathname = () =>
  new URL(location.href).searchParams.get("route") || "/dashboard";
export const useRouter = () => ({ refresh() {}, push() {}, replace() {} });
export const signOut = async () => {};
export const signIn = async () => {};
export default function PreviewLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...props} href={`?route=${encodeURIComponent(String(href))}`}>
      {children}
    </a>
  );
}
