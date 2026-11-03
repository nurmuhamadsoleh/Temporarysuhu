# Audit module resolution — 3 November 2026

## Temuan utama

Kelima modul pada pesan error tersedia pada workspace dan sudah tercatat dalam commit awal Git. Build Webpack lokal **sebelum perubahan** berhasil (exit 0) menggunakan tsconfig.json yang ada. Karena itu error yang dilaporkan tidak dapat direproduksi pada workspace lengkap ini.

Namun, `git ls-files --error-unmatch tsconfig.json` gagal: konfigurasi tersebut belum tercatat di Git. Checkout dari commit awal tidak memiliki mapping alias, sementara source menggunakan `@/`. Ini merupakan cacat kelengkapan repository yang terverifikasi dan menjelaskan kegagalan resolusi alias pada checkout tanpa konfigurasi tersebut. Lingkungan build lain yang menghasilkan screenshot/error tidak diakses secara langsung.

| Import | Target aktual | Hasil audit |
| --- | --- | --- |
| `@/components/ui` | `src/components/ui.tsx` | File dengan named exports, tersedia dan tracked; bukan import ke folder ui |
| `@/lib/domain` | `src/lib/domain.ts` | Logic domain asli tersedia dan tracked |
| `@/lib/temperature-report/scene` | `src/lib/temperature-report/scene.ts` | Renderer bersama SVG/PDF tersedia dan tracked |
| `@/lib/temperature-report/model` | `src/lib/temperature-report/model.ts` | Model/normalisasi laporan tersedia dan tracked |
| `@/config/report` | `src/config/report.ts` | Konfigurasi laporan terpusat tersedia dan tracked |

Tidak ada file source hilang atau salah lokasi. Tidak diperlukan penggantian import, barrel export, implementasi domain/renderer baru, atau modul placeholder. Semua 103 file TypeScript source tercatat di Git; 277 import lokal berhasil diresolusikan dengan kapitalisasi tepat. Ketergantungan balik `temperature-policy -> domain` hanya berupa `import type`, sehingga tidak menjadi circular dependency runtime yang perlu diubah.

## Perubahan

- `tsconfig.json`: memperjelas `baseUrl: "."`, mempertahankan `@/* -> ./src/*`, menambahkan `forceConsistentCasingInFileNames: true`. Strict mode, plugin Next.js, opsi lain, include dan exclude dipertahankan. File harus disertakan dalam commit/upload bersama source.
- `scripts/check-imports.mjs`: memakai resolver TypeScript dan membandingkan kapitalisasi setiap bagian path dengan nama pada filesystem. Memeriksa static import/export, dynamic import dan require literal; mengenali stylesheet Next. Config hilang, mapping salah, source kosong, modul hilang dan kapitalisasi salah menghasilkan exit 1.
- `package.json`: menambahkan `check:imports` dan `prebuild` untuk mendeteksi checkout/upload tidak lengkap sebelum Webpack dijalankan. Perintah build tetap `next build --webpack`.
- `tests/import-check.test.ts`: lima pengujian terisolasi untuk alias/CSS valid, config hilang, modul hilang, kapitalisasi salah dan konfigurasi yang tidak mencakup source. Fixture dihapus setelah pengujian.
- `.gitignore`: melindungi pola file OAuth/service-account lokal yang nyata serta tmp/output hasil pengujian. Perlindungan .env, sertifikat, private storage dan pengecualian .env.example dipertahankan. Tidak ada file kredensial yang ditambahkan ke Git.
- `README.md` dan dokumen ini: panduan checkout/build/deployment.
- `next-env.d.ts`: diperbarui otomatis oleh Next build ke `.next/types/`; bukan perbaikan alias manual.

`next.config.ts` tidak diubah: tidak ada custom `webpack.resolve.alias` yang menimpa alias Next. Next.js 16.4.3 memang mendukung paths tanpa baseUrl, sebagaimana implementasi `load-jsconfig.js` terpasang. Penambahan baseUrl adalah penegasan konfigurasi, bukan klaim bahwa ketiadaan baseUrl sebelumnya pasti menyebabkan error. Faktor pentingnya adalah konfigurasi alias harus ikut checkout.

Tidak ada perubahan dependency/package-lock, business logic, role, OAuth, schema Google Sheets, presisi suhu, timestamp, generator PDF, sertifikat maupun data historis.

## Pemeriksaan yang dapat dijalankan

```bash
npm ci
npm run check:imports
npm run typecheck
npm run lint
npm test
npm run build
```

`npx next build --webpack` juga menggunakan paths pada tsconfig.json, tetapi tidak menjalankan lifecycle prebuild npm. Jalankan check:imports secara terpisah jika memakai perintah tersebut.

Pada sesi PowerShell audit, wrapper npm global menunjuk ke npm-cli.js yang tidak tersedia. CLI npm instalasi Node digunakan untuk menjalankan lifecycle build yang sama:

```powershell
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run build
```

Ini hanya alternatif lokal untuk wrapper npm; bukan path yang ditambahkan ke aplikasi atau deployment Linux.

Git pada sesi audit melaporkan perbedaan pemilik direktori. Pemeriksaan menggunakan `git -c safe.directory=<path-repository> ...` per perintah, tanpa mengubah safe.directory global. Perubahan disiapkan secara selektif; tidak menggunakan git add seluruh direktori, tidak membuat commit/push otomatis, dan tidak memasukkan kredensial.

## Hostinger / Linux

- Sertakan tsconfig.json, next.config.ts, package.json/package-lock.json, src, scripts dan konfigurasi build lain dalam commit/upload yang sama. Jika prebuild menyebut file hilang, perbaiki paket source yang diunggah; jangan menghapus import atau mematikan typecheck.
- Instal dev dependencies saat build (`npm ci`), lalu `npm run build`; gunakan runtime Node.js sesuai panduan deployment. Pemeriksaan lokal memakai Node.js 22.22.3, TypeScript 5.9.3 dan Next.js 16.4.3.
- Path import telah diperiksa case-sensitive secara eksplisit meskipun filesystem pengujian Windows. Tidak ada klaim bahwa aplikasi telah dibangun langsung pada Linux/Hostinger dalam audit ini.
- Implementasi signing server tetap memakai `OPENSSL_PATH` atau executable `openssl`. Contoh production memakai `/usr/bin/openssl`, bukan path Windows. Sertifikat dan private storage harus menggunakan path absolut server sesuai panduan deployment existing.
- Google OAuth, permission, environment production dan akses Sheets tetap memerlukan konfigurasi server yang sah. Audit ini tidak login sebagai pengguna, tidak melakukan write Sheets atau publikasi production.

Lihat [panduan deployment](DEPLOYMENT.md) dan [production Hostinger](PRODUCTION_HOSTINGER.md).

## Hasil verifikasi akhir

- `check:imports`: lulus, 103 source / 277 import lokal; seluruh target dan kapitalisasi tepat.
- `tsc --noEmit`: lulus (exit 0).
- `eslint .`: lulus (exit 0).
- Vitest: **191 tes pada 29 file lulus**, tanpa skip; mencakup PDF, line chart, precision/null, corrective action, identitas petugas, approval/role, serta signing dan deteksi modifikasi PDF dengan sertifikat uji.
- `npm run build` melalui CLI npm instalasi Node: lifecycle prebuild dan `next build --webpack` **berhasil (exit 0)**; 19 halaman statis dibuat. Log lokal: `tmp/alias-build-after.log`.
- `next.config.ts` dan package-lock.json tidak berubah; tidak ada error module resolution/missing exports pada build akhir.
- File source aplikasi tetap asli; tidak ada perubahan data Google Sheets atau API/authorization.

Konfigurasi tsconfig dan file baru pemeriksaan import disiapkan pada Git index bersama perubahan inti terkait, tanpa commit/push otomatis. Commit dan kirim perubahan tersebut bersama source sebelum deploy; staging lokal belum mengubah HEAD atau server Hostinger.
