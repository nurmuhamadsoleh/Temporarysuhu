"use client";
import { useState } from "react";
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, RefreshCw, Users } from "lucide-react";
import { roles, type Role } from "@/lib/domain";
import {
  inviteSchema,
  userStatuses,
  safePicture,
  type AppUser,
  type UserStatus,
} from "@/lib/users";
import { api, useData, ErrorBox } from "@/components/ui";
const time = (v: string) =>
  v
    ? new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
function Content() {
  const [mobilePage, setMobilePage] = useState(1);
  const [q, setQ] = useState(""),
    [role, setRole] = useState<Role | undefined>(),
    [status, setStatus] = useState<UserStatus | undefined>(),
    [inviteOpen, setInviteOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<AppUser | null>(null),
    [nextRole, setNextRole] = useState<Role>("PETUGAS"),
    [detail, setDetail] = useState<{
      user: AppUser;
      activity: unknown[][];
    } | null>(null);
  const { modal } = App.useApp();
  const { data, error, loading, refresh } = useData<AppUser[]>(
    `/api/users?${new URLSearchParams({ q, role: role || "", status: status || "" })}`,
  );
  const {
    control,
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<
    z.input<typeof inviteSchema>,
    unknown,
    z.output<typeof inviteSchema>
  >({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "PETUGAS", status: "PENDING", notes: "" },
  });
  async function mutate(
    u: AppUser,
    action: string,
    payload: Record<string, unknown>,
    method = "PATCH",
  ) {
    setBusy(true);
    try {
      await api(`/api/users/${u.id}/${action}`, {
        method,
        body: JSON.stringify({ ...payload, version: u.updatedAt }),
      });
      toast.success("Perubahan pengguna tersimpan");
      setEdit(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const renderActions = (u: AppUser) => (
    <Space wrap>
      <Button
        size="small"
        onClick={async () => {
          try {
            setDetail(await api(`/api/users/${u.id}`));
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        Detail
      </Button>
      <Button
        size="small"
        disabled={busy}
        onClick={() => {
          setEdit(u);
          setNextRole(u.role);
        }}
      >
        Edit Role
      </Button>
      <Popconfirm
        title={
          u.status === "ACTIVE" ? "Nonaktifkan akun ini?" : "Aktifkan akun ini?"
        }
        description="Perubahan berlaku pada sesi yang sedang aktif dan dicatat di audit."
        onConfirm={() =>
          mutate(u, "status", {
            status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
          })
        }
        okText="Konfirmasi"
        cancelText="Batal"
      >
        <Button size="small" disabled={busy} danger={u.status === "ACTIVE"}>
          {u.status === "ACTIVE" ? "Nonaktifkan" : "Aktifkan"}
        </Button>
      </Popconfirm>
      <Dropdown
        menu={{
          items: [
            {
              key: "approve",
              label: "Setujui registrasi",
              disabled: u.status !== "PENDING",
            },
            {
              key: "reject",
              label: "Tolak registrasi",
              disabled: u.status !== "PENDING",
              danger: true,
            },
          ],
          onClick: ({ key }) =>
            modal.confirm({
              title:
                key === "approve" ? "Setujui registrasi?" : "Tolak registrasi?",
              content: `Akun ${u.email}. Tindakan akan diaudit.`,
              okText: "Konfirmasi",
              cancelText: "Batal",
              onOk: () => mutate(u, key, {}, "POST"),
            }),
        }}
      >
        <Button size="small">Lainnya</Button>
      </Dropdown>
    </Space>
  );
  const columns: ColumnsType<AppUser> = [
    { title: "No", key: "no", render: (_, __, i) => i + 1, width: 55 },
    {
      title: "Foto",
      key: "picture",
      render: (_, u) => (
        <Avatar src={safePicture(u.picture) || undefined}>{u.name[0]}</Avatar>
      ),
      width: 65,
    },
    {
      title: "Nama",
      dataIndex: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, u) => (
        <div>
          <strong>{u.name}</strong>
          {!u.googleId && (
            <small className="block text-slate-600">
              Undangan / belum ditautkan
            </small>
          )}
        </div>
      ),
    },
    { title: "Email", dataIndex: "email" },
    {
      title: "Role",
      dataIndex: "role",
      render: (v) => (
        <Tag color={v === "SUPER_ADMIN" ? "purple" : "blue"}>{v}</Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (v) => (
        <Tag
          color={v === "ACTIVE" ? "green" : v === "PENDING" ? "gold" : "red"}
        >
          {v}
        </Tag>
      ),
    },
    {
      title: "Tanggal Registrasi",
      dataIndex: "registeredAt",
      render: time,
      sorter: (a, b) => a.registeredAt.localeCompare(b.registeredAt),
    },
    { title: "Login Terakhir", dataIndex: "lastLogin", render: time },
    {
      title: "Aksi",
      key: "action",
      fixed: "right",
      width: 240,
      render: (_, u) => renderActions(u),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUPER ADMIN WORKSPACE</span>
          <h1>Manajemen Pengguna</h1>
          <p>Kelola pendaftaran, undangan, peran, dan akses akun Google.</p>
        </div>
        <Space wrap>
          <Button
            icon={<RefreshCw size={15} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={() => setInviteOpen(true)}
          >
            Tambah Pengguna
          </Button>
        </Space>
      </div>
      <section className="panel">
        <div className="user-filters">
          <Input.Search
            aria-label="Cari nama atau email"
            placeholder="Cari nama atau email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setMobilePage(1);
            }}
            style={{ width: "100%" }}
            allowClear
          />
          <Select
            aria-label="Filter role"
            placeholder="Semua role"
            allowClear
            value={role}
            onChange={(v) => {
              setRole(v);
              setMobilePage(1);
            }}
            options={roles.map((value) => ({ value, label: value }))}
            style={{ width: "100%" }}
          />
          <Select
            aria-label="Filter status"
            placeholder="Semua status"
            allowClear
            value={status}
            onChange={(v) => {
              setStatus(v);
              setMobilePage(1);
            }}
            options={userStatuses.map((value) => ({ value, label: value }))}
            style={{ width: "100%" }}
          />
        </div>
        {error ? (
          <ErrorBox message={error} retry={refresh} />
        ) : (
          <>
            <div className="users-mobile-list" aria-busy={loading}>
              {loading ? (
                <p role="status">Memuat pengguna…</p>
              ) : !data?.length ? (
                <p>Belum ada pengguna sesuai filter.</p>
              ) : (
                data.slice((mobilePage - 1) * 10, mobilePage * 10).map((u) => (
                  <article className="user-mobile-card" key={u.id}>
                    <div className="user-card-heading">
                      <Avatar src={safePicture(u.picture) || undefined}>
                        {u.name[0]}
                      </Avatar>
                      <strong>{u.name}</strong>
                    </div>
                    <p>{u.email}</p>
                    <Tag color="blue">{u.role}</Tag>
                    <Tag color={u.status === "ACTIVE" ? "green" : "gold"}>
                      {u.status}
                    </Tag>
                    <div>{renderActions(u)}</div>
                  </article>
                ))
              )}
              <Pagination
                current={mobilePage}
                onChange={setMobilePage}
                pageSize={10}
                total={data?.length || 0}
                simple
                hideOnSinglePage
                aria-label="Halaman pengguna"
              />
            </div>
            <Table<AppUser>
              className="users-desktop-table"
              rowKey="id"
              columns={columns}
              dataSource={data || []}
              loading={loading}
              scroll={{ x: 1250 }}
              pagination={{
                defaultPageSize: 10,
                showSizeChanger: true,
                showTotal: (n) => `${n} pengguna`,
              }}
              locale={{
                emptyText: (
                  <div className="empty">
                    <Users />
                    <h3>Belum ada pengguna sesuai filter</h3>
                  </div>
                ),
              }}
            />
          </>
        )}
      </section>
      <Modal
        title="Tambah Pengguna Google"
        open={inviteOpen}
        onCancel={() => {
          if (!busy) setInviteOpen(false);
        }}
        footer={null}
        destroyOnHidden
      >
        <p className="muted mb-5">
          Undangan ditautkan ke identitas Google asli pada login pertama. Tidak
          ada password atau Google ID buatan.
        </p>
        <form
          onSubmit={handleSubmit(async (input) => {
            setBusy(true);
            try {
              await api("/api/users/invite", {
                method: "POST",
                body: JSON.stringify(input),
              });
              toast.success("Undangan pengguna dibuat");
              reset();
              setInviteOpen(false);
              await refresh();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          })}
        >
          <label>
            Email Google
            <input type="email" {...register("email")} autoComplete="off" />
            {errors.email && (
              <small className="field-error">{errors.email.message}</small>
            )}
          </label>
          <label>
            Role
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  options={roles.map((value) => ({ value, label: value }))}
                />
              )}
            />
          </label>
          <label>
            Status
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  options={userStatuses.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              )}
            />
          </label>
          <label>
            Keterangan
            <textarea maxLength={1000} {...register("notes")} />
          </label>
          <Popconfirm
            title="Buat undangan dengan role dan status ini?"
            description="Role SUPER_ADMIN memberikan akses penuh. Identitas pembuat dan tindakan akan diaudit."
            onConfirm={() => {
              const form = document.getElementById(
                "invite-submit",
              ) as HTMLButtonElement;
              form.click();
            }}
            okText="Konfirmasi"
            cancelText="Batal"
          >
            <Button type="primary" loading={busy}>
              Simpan Undangan
            </Button>
          </Popconfirm>
          <button type="submit" id="invite-submit" hidden>
            Submit
          </button>
        </form>
      </Modal>
      <Modal
        title="Ubah Role Pengguna"
        open={!!edit}
        onCancel={() => {
          if (!busy) setEdit(null);
        }}
        footer={null}
      >
        <p className="muted mb-4">{edit?.email}</p>
        <Select
          aria-label="Role baru"
          value={nextRole}
          onChange={setNextRole}
          options={roles.map((value) => ({ value, label: value }))}
          style={{ width: "100%" }}
        />
        <p className="sop-notice mt-4">
          Perubahan hak akses berlaku segera. Super Admin aktif terakhir
          dilindungi oleh server.
        </p>
        <Popconfirm
          title="Konfirmasi perubahan role?"
          description={
            nextRole === "SUPER_ADMIN"
              ? "Pengguna akan memiliki akses administratif penuh."
              : "Akses sesi aktif mengikuti role yang baru."
          }
          onConfirm={() =>
            edit ? mutate(edit, "role", { role: nextRole }) : Promise.resolve()
          }
          okText="Konfirmasi"
          cancelText="Batal"
        >
          <Button type="primary" loading={busy}>
            Simpan Role
          </Button>
        </Popconfirm>
      </Modal>
      <Modal
        title="Detail & Riwayat Aktivitas"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Tutup</Button>}
        width={800}
      >
        {detail && (
          <>
            <div className="account-summary">
              <strong>{detail.user.name}</strong>
              <p>{detail.user.email}</p>
              <p>Google ID: {detail.user.googleId || "Belum ditautkan"}</p>
              <p>Registrasi: {time(detail.user.registeredAt)}</p>
              <p>
                Disetujui: {time(detail.user.approvedAt)} ·{" "}
                {detail.user.approvedBy || "—"}
              </p>
              <p>Diundang/dibuat oleh: {detail.user.createdBy}</p>
              <Tag>{detail.user.role}</Tag>
              <Tag>{detail.user.status}</Tag>
            </div>
            <h3 className="my-4">100 aktivitas terakhir</h3>
            <div className="max-h-96 overflow-auto">
              {detail.activity.length ? (
                detail.activity.map((r, i) => (
                  <details key={i} className="border-b border-slate-100 py-3">
                    <summary>
                      {String(r[1])} · {String(r[3])}
                    </summary>
                    <pre className="whitespace-pre-wrap break-all text-xs mt-2">
                      {JSON.stringify({ before: r[5], after: r[6] }, null, 2)}
                    </pre>
                  </details>
                ))
              ) : (
                <p className="muted">Belum ada aktivitas.</p>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
export function UsersManagement() {
  return (
    <App>
      <Content />
    </App>
  );
}
