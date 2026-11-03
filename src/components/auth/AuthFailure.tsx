"use client";
export function AuthFailure({ retry }: { retry: () => void }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f1f5f9",
        color: "#0f172a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 480,
          padding: 28,
          borderRadius: 16,
          background: "white",
          boxShadow: "0 8px 28px #0f172a14",
        }}
      >
        <p style={{ fontWeight: 700, color: "#1e3a8a" }}>TempControl</p>
        <h1 style={{ fontSize: 24, lineHeight: 1.3 }}>
          Layanan belum tersedia
        </h1>
        <p role="alert" style={{ fontSize: 16, lineHeight: 1.6 }}>
          Halaman belum dapat dimuat. Coba lagi atau hubungi administrator jika
          masalah berlanjut.
        </p>
        <button
          type="button"
          onClick={retry}
          style={{
            minHeight: 44,
            padding: "10px 20px",
            border: 0,
            borderRadius: 8,
            background: "#1d4ed8",
            color: "white",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Coba lagi
        </button>
        <p>
          <a
            href="/auth/error"
            style={{
              color: "#1d4ed8",
              display: "inline-block",
              padding: "12px 0",
            }}
          >
            Buka bantuan login
          </a>
        </p>
      </section>
    </main>
  );
}
