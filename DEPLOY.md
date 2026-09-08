# Panduan Deploy ke Vercel dengan Supabase Sendiri

Dokumen ini menjelaskan cara menjalankan webapp ini di Vercel (deploy dari GitHub)
dengan database dan autentikasi Supabase milik sendiri, tanpa mengubah apa pun
pada project yang berjalan di Lovable.

Satu kode, dua backend. Perbedaannya hanya di environment variable masing-masing
hosting.

---

## 1. Siapkan project Supabase sendiri

1. Buat project baru di https://supabase.com (paket gratis cukup untuk memulai).
2. Buka **SQL Editor**, lalu jalankan semua berkas di folder `supabase/migrations/`
   **berurutan sesuai nama berkas** (nama berkas diawali tanggal, jadi urutkan
   dari yang paling lama).
   Ini akan membuat seluruh tabel, aturan akses (RLS), fungsi, dan trigger
   persis seperti yang berjalan sekarang.
3. Catat tiga nilai dari **Project Settings -> API**:
   - Project URL (`https://xxxx.supabase.co`)
   - Project reference id (`xxxx`)
   - `anon` / publishable key
   - `service_role` key (rahasia, hanya untuk server)

## 2. Aktifkan login

Di Supabase baru, buka **Authentication -> Providers**:

- Aktifkan **Google** dan isi Client ID / Client Secret dari Google Cloud Console.
- Di **Authentication -> URL Configuration**, isi:
  - Site URL: `https://newjobsign.vercel.app`
  - Redirect URLs: `https://newjobsign.vercel.app/**`

Di Google Cloud Console, tambahkan authorized redirect URI:
`https://<project-ref>.supabase.co/auth/v1/callback`

## 3. Pindahkan data lama (opsional)

- Ekspor lewat menu **Backup** di webapp (halaman `/owner/backup`), lalu impor
  hasilnya ke Supabase baru.
- Urutan impor yang aman: `profiles`, `user_roles`, `employees`, `customers`,
  `projects`, `orders`, `order_items`, sisanya.

## 4. Isi environment variable di Vercel

Buka **Project Settings -> Environment Variables** di Vercel, tambahkan untuk
scope **Production** dan **Preview**:

| Nama | Isi |
| --- | --- |
| `SUPABASE_URL` | Project URL Supabase Anda |
| `SUPABASE_PUBLISHABLE_KEY` | anon / publishable key |
| `SUPABASE_PROJECT_ID` | project reference id |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SHOPEE_PARTNER_ID` | Partner ID Shopee Open Platform |
| `SHOPEE_PARTNER_KEY` | Partner Key Shopee Open Platform |
| `GOOGLE_DRIVE_API_KEY` | API key Google Drive (foto garapan) |

Variabel `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, dan
`VITE_SUPABASE_PROJECT_ID` **tidak perlu diisi manual** — berkas
`.env.production` sudah menyalinnya otomatis dari tiga variabel `SUPABASE_*`
di atas saat build production.

Kalau ingin mengisi manual pun boleh; nilai dari dashboard Vercel selalu menang
atas isi berkas `.env` di repo.

Setelah menambah/mengubah variabel, jalankan **Redeploy** (build ulang wajib,
karena nilai `VITE_*` ditanam saat build).

## 5. Integrasi Shopee

- Redirect URL OAuth Shopee hanya bisa menunjuk ke satu alamat pada satu waktu.
  Kalau ingin menghubungkan toko dari Vercel, ubah redirect URL di Shopee Open
  Platform menjadi:
  `https://newjobsign.vercel.app/api/public/shopee/callback`
  dan isi nilai yang sama di halaman **Integrasi Shopee** dalam webapp.
- Sinkronisasi otomatis: tambahkan Vercel Cron yang memanggil
  `POST /api/public/hooks/sync-shopee` setiap jam, dengan header
  `apikey: <SUPABASE_PUBLISHABLE_KEY>`.

## 6. Verifikasi

Cek satu per satu di `https://newjobsign.vercel.app`:

- Login berhasil dan sidebar muncul sesuai role.
- Halaman Orderan, Status, Project, Laporan menampilkan data.
- Import Shopee, generate/print resi, absensi, dan Backup berjalan.

Kalau halaman terbuka tetapi datanya kosong, hampir selalu penyebabnya adalah
variabel `SUPABASE_*` yang belum lengkap atau belum di-redeploy.

## Catatan

- Project di Lovable tidak terpengaruh sama sekali. Lovable memakai berkas
  `.env` di repo (mode development), Vercel memakai `.env.production` +
  environment variable dashboard.
- Fitur yang memakai `SUPABASE_SERVICE_ROLE_KEY` (import Shopee, sinkronisasi,
  backup) hanya bisa berjalan di Vercel setelah memakai Supabase sendiri,
  karena kunci tersebut tidak tersedia di Lovable Cloud.
- Kalau build di Vercel gagal pada tahap server bundle, set environment
  variable tambahan `NITRO_PRESET=vercel`.
