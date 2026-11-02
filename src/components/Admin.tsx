"use client";
import Link from "next/link";
import { TemperaturePolicyEditor } from "./temperature/TemperaturePolicyEditor";
import { useData, Loading, ErrorBox } from "./ui";
import type { Sop } from "@/lib/domain";
export function Admin({
  canManageUsers = false,
}: {
  canManageUsers?: boolean;
}) {
  const { data, error, loading, refresh } = useData<{
    sop: Sop;
    audit: string[][];
  }>("/api/admin");
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>Pengaturan workspace</h1>
          <p>Batas SOP operasional dan audit perubahan.</p>
        </div>
        {canManageUsers && (
          <Link className="btn primary" href="/dashboard/users">
            Manajemen Pengguna
          </Link>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        data && (
          <>
            <section className="panel">
              <h2>Batas aman suhu sesuai SOP</h2>
              <p className="muted my-4">
                Berlaku untuk pengukuran berikutnya. Status historis
                dipertahankan.
              </p>
              {canManageUsers ? (
                <TemperaturePolicyEditor />
              ) : (
                <p>
                  Pengelolaan kebijakan suhu hanya tersedia untuk Super Admin.
                </p>
              )}
            </section>
            {canManageUsers && (
              <section className="panel mt-6">
                <h2>Audit trail</h2>
                <p className="muted my-3">100 perubahan terbaru.</p>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Tabel data; geser horizontal untuk kolom lainnya"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Actor</th>
                        <th>Aksi</th>
                        <th>Entity</th>
                        <th>Perubahan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.audit.map((r) => (
                        <tr key={r[0]}>
                          <td>{r[1]}</td>
                          <td>{r[2]}</td>
                          <td>{r[3]}</td>
                          <td>{r[4]}</td>
                          <td>
                            <details>
                              <summary>Lihat</summary>
                              <pre className="max-w-96 whitespace-pre-wrap break-all text-xs">
                                {r[5]}
                                {"\n"}
                                {r[6]}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
