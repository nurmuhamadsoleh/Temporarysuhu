"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drawer } from "antd";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Thermometer,
  Snowflake,
  FileBarChart,
  Settings,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  Activity,
  Users,
} from "lucide-react";
import type { Actor } from "@/lib/domain";
import { safePicture } from "@/lib/users";
const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/users", label: "Manajemen Pengguna", icon: Users },
  { href: "/suhu-chiller", label: "Suhu Chiller", icon: Thermometer },
  { href: "/suhu-freezer", label: "Suhu Freezer", icon: Snowflake },
  { href: "/laporan", label: "Laporan", icon: FileBarChart },
  { href: "/pengaturan", label: "Pengaturan", icon: Settings },
];
function SidebarContent({
  actor,
  path,
  onNavigate,
}: {
  actor: Actor;
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="sidebar-content">
      <Link href="/dashboard" className="brand">
        <span className="brand-icon">
          <Activity />
        </span>
        <span>
          Temp<span className="text-blue-600">Control</span>
          <small>KITCHEN MONITORING</small>
        </span>
      </Link>
      <div className="workspace-label">
        RUANG KERJA<span>OPERASIONAL DAPUR</span>
      </div>
      <p className="nav-label">MENU UTAMA</p>
      <nav className="workspace-nav" aria-label="Navigasi utama">
        {navigation
          .filter(
            (n) =>
              (n.href !== "/pengaturan" ||
                ["ADMIN", "SUPER_ADMIN"].includes(actor.role)) &&
              (n.href !== "/dashboard/users" || actor.role === "SUPER_ADMIN"),
          )
          .map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={path === n.href ? "page" : undefined}
              className={path === n.href ? "active" : ""}
            >
              <n.icon size={20} />
              {n.label}
              {path === n.href && <span className="nav-dot" />}
            </Link>
          ))}
      </nav>
      <div className="sidebar-bottom">
        <ShieldCheck size={22} />
        <strong>Data aman & terpantau</strong>
        <p>Pengukuran dan perubahan tercatat untuk kebutuhan audit.</p>
        <small>Asia/Jakarta · WIB</small>
      </div>
    </div>
  );
}
export function Shell({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Lewati navigasi
      </a>
      <aside className="sidebar desktop-sidebar">
        <SidebarContent actor={actor} path={path} />
      </aside>
      <Drawer
        title="Navigasi TempControl"
        className="navigation-drawer"
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        size="min(320px, calc(100vw - 24px))"
        destroyOnHidden
        styles={{ body: { padding: 16 } }}
      >
        <div id="mobile-navigation">
          <SidebarContent
            actor={actor}
            path={path}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </Drawer>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Buka navigasi"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <span className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{navigation.find((n) => n.href === path)?.label}</strong>
          </span>
          <div className="topbar-user">
            <div className="avatar" aria-label={actor.name}>
              {safePicture(actor.picture) ? (
                <img
                  src={safePicture(actor.picture)}
                  alt={`Foto profil ${actor.name}`}
                  referrerPolicy="no-referrer"
                  width={36}
                  height={36}
                  className="rounded-full"
                />
              ) : (
                actor.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div
              className="topbar-identity"
              title={`${actor.name} · ${actor.role}`}
            >
              <strong>{actor.name}</strong>
              <small>{actor.role}</small>
            </div>
            <button
              className="icon-btn"
              aria-label="Keluar"
              onClick={() => void signOut({ callbackUrl: "/login" })}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="app-footer">
          Temperature Monitoring System{" "}
          <span>Monitoring yang konsisten. Kualitas yang terjaga.</span>
        </footer>
      </div>
    </div>
  );
}
