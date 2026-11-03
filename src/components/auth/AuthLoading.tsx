export default function AuthLoading() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4 text-slate-900">
      <section
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm"
      >
        <p className="text-sm font-semibold text-blue-700">TempControl</p>
        <h1 className="mt-3 text-2xl font-semibold">Menyiapkan halaman…</h1>
        <p className="mt-2 text-base leading-relaxed text-slate-600">
          Mohon tunggu sebentar.
        </p>
        <div
          aria-hidden="true"
          className="mt-5 h-2 animate-pulse rounded-full bg-blue-100 motion-reduce:animate-none"
        />
      </section>
    </main>
  );
}
