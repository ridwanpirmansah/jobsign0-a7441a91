# Arahkan Deployment Vercel ke Supabase Sendiri (Lovable Tetap Utuh)

Tujuan: `newjobsign.vercel.app` (deploy dari GitHub) memakai database/auth Supabase milik Anda sendiri, sementara webapp di Lovable tetap memakai Lovable Cloud seperti sekarang. Satu kode, dua backend, dibedakan oleh pengaturan environment di masing-masing hosting.

## Kabar baik: nyaris tanpa perubahan kode

Hasil pemeriksaan kode: tidak ada alamat database yang ditulis mati di dalam kode. Semua koneksi dibaca dari environment variable:

- Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Server (server function & endpoint publik): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

Jadi cukup mengisi nilai berbeda di Vercel. Lovable tidak terpengaruh sama sekali.

## Satu masalah yang harus dibereskan lebih dulu

File `.env` di repo berisi nilai Lovable Cloud dan ikut terbawa ke GitHub. Saat build di Vercel, nilai dari file ini bisa menimpa pengaturan yang Anda isi di dashboard Vercel, sehingga Vercel tetap menempel ke database Lovable. Ini kemungkinan besar juga penyebab data tidak tampil sekarang.

Solusi yang saya siapkan: menambahkan file `.env.production` di repo yang membaca dari pengaturan hosting, sehingga build production (Vercel) memakai nilai Vercel dan build di Lovable tetap memakai `.env` bawaan. Perubahan ini aman untuk Lovable karena Lovable tidak memakai mode production build yang sama.

## Yang perlu Anda siapkan di sisi Supabase sendiri

1. Buat project baru di Supabase (paket gratis cukup untuk mulai).
2. Jalankan seluruh berkas migrasi dari folder `supabase/migrations` (21 berkas, urut sesuai nama) di SQL Editor Supabase. Ini membangun semua tabel, aturan akses, dan fungsi persis seperti sekarang.
3. Aktifkan login Google di Supabase baru, dan tambahkan `https://newjobsign.vercel.app` sebagai URL yang diizinkan.
4. Salin data lama: ekspor dari menu Backup yang sudah ada di webapp, lalu impor ke Supabase baru. (Saya bisa bantu buatkan berkas SQL ekspor lengkap kalau perlu.)

## Yang perlu diisi di dashboard Vercel

Environment variable (Production + Preview):

| Nama | Isi |
|---|---|
| `VITE_SUPABASE_URL` | URL project Supabase Anda |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon/publishable key Supabase Anda |
| `VITE_SUPABASE_PROJECT_ID` | project ref Supabase Anda |
| `SUPABASE_URL` | sama dengan di atas |
| `SUPABASE_PUBLISHABLE_KEY` | sama dengan anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key dari Supabase Anda |
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | kredensial Shopee |
| `GOOGLE_DRIVE_API_KEY` | untuk foto garapan |

Catatan penting: `SUPABASE_SERVICE_ROLE_KEY` tidak bisa diambil dari Lovable Cloud. Fitur yang memerlukannya (import Shopee, sinkronisasi, backup) baru berjalan di Vercel setelah Anda memakai Supabase sendiri — jadi langkah ini justru memperbaikinya.

## Yang saya kerjakan di project ini

1. Menambah `.env.production` agar build production membaca env dari hosting, bukan dari `.env` bawaan Lovable.
2. Menambah `vercel.json` bila diperlukan agar perintah build dan output cocok dengan Vercel.
3. Menambah panduan singkat `DEPLOY.md` berisi daftar env dan urutan langkah, supaya bisa Anda ikuti tanpa perlu bertanya lagi.
4. Memastikan tidak ada kode yang mengasumsikan lingkungan Lovable (pemeriksa alamat preview di penyimpanan sesi sudah otomatis nonaktif di domain non-Lovable, jadi aman).

Tidak ada perubahan tampilan, fitur, maupun skema database di webapp Lovable.

## Setelah itu

- Shopee: ubah redirect URL di panel Shopee ke `https://newjobsign.vercel.app/api/public/shopee/callback` bila Anda ingin menghubungkan toko dari Vercel. Kalau Shopee masih dipakai dari Lovable, biarkan seperti sekarang (satu redirect URL hanya bisa satu alamat pada satu waktu).
- Cron sinkronisasi Shopee: pasang Vercel Cron memanggil `/api/public/hooks/sync-shopee` tiap jam.

## Technical Details

- `src/integrations/supabase/client.ts` membaca `import.meta.env.VITE_SUPABASE_URL` dengan fallback `process.env.SUPABASE_URL`; `client.server.ts` dan `auth-middleware.ts` membaca `process.env` — semuanya sudah portabel, tidak perlu diubah.
- `previewAuthStorage.ts` hanya aktif pada host `*.lovable.app` / `*.lovableproject.com`; di Vercel otomatis memakai `localStorage`.
- `vite.config.ts` memakai `@lovable.dev/vite-tanstack-config` dengan target nitro Cloudflare; perlu diverifikasi apakah Vercel build saat ini memakai preset yang benar — bila tidak, tambahkan preset/`vercel.json` yang sesuai.
- Migrasi database: jalankan `supabase/migrations/*.sql` berurutan; tidak ada migrasi baru dalam rencana ini.
