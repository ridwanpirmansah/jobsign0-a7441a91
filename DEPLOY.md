# Panduan Deploy ke Vercel dengan Supabase Sendiri

Dokumen ini menjelaskan cara menjalankan webapp ini di Vercel (deploy dari GitHub)
dengan database dan autentikasi Supabase milik sendiri, tanpa mengubah apa pun
pada project yang berjalan di Lovable.

Satu kode, dua backend. Perbedaannya hanya di environment variable masing-masing
hosting.

---

## 1. Siapkan project Supabase sendiri

1. Buat project baru di https://supabase.com (paket gratis cukup untuk memulai).
   Pastikan database masih **kosong**. Kalau sebelumnya sudah pernah mencoba
   menjalankan berkas migrasi lama dan gagal di tengah, kosongkan dulu dengan
   menjalankan perintah ini di SQL Editor:

   ```sql
   drop schema public cascade;
   create schema public;
   grant usage on schema public to anon, authenticated, service_role;
   ```

2. Buka berkas **`supabase/schema.sql`**, salin **seluruh isinya**, tempel ke
   **SQL Editor**, lalu klik **Run** sekali. Berkas ini adalah potret struktur
   database yang sedang berjalan sekarang (tabel, aturan akses/RLS, fungsi,
   trigger, hak akses, dan data awal seperti master harga, ekspedisi, tarif
   borongan, setelan absensi) — bukan tumpukan riwayat migrasi, jadi urutannya
   sudah benar dan cukup sekali jalan.
   - Berkas gabungan lama `supabase/all_migrations.sql` sudah dihapus karena
     memutar ulang 81 langkah perubahan dan selalu gagal di tengah.
   - Folder `supabase/migrations` tetap disimpan sebagai catatan riwayat. Bila
     nanti ada migrasi baru dari Lovable, jalankan hanya berkas baru tersebut.

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

- Ekspor lewat menu **Backup Semua (.zip)** di webapp lama (halaman
  `/owner/backup`), lalu gunakan **Restore Semua (.zip)** di webapp baru.
- Restore Semua otomatis memproses tabel sesuai urutan relasi, menyesuaikan
  backup versi lama, dan menyambungkan kembali Order–Project.
- Akun login lama tidak ikut dipindahkan karena terikat ke sistem autentikasi
  lama. Seluruh data karyawan tetap dipulihkan tanpa akun. Minta karyawan
  registrasi di webapp baru, lalu owner menghubungkan akun baru mereka dari
  halaman **Karyawan**.
- Hindari restore CSV satu per satu untuk pemindahan lengkap; tabel seperti
  absensi dan riwayat pengiriman membutuhkan data induk yang dipulihkan lebih
  dahulu.

## 4. Isi environment variable di Vercel

Berkas `.env.production` di repo sengaja DIKOSONGKAN, karena berkas itu juga
ikut terbaca saat publikasi di Lovable dan membuat webapp Lovable menunjuk ke
Supabase pribadi. Jadi semua nilai diisi di **Project Settings -> Environment
Variables** Vercel (scope **Production** dan **Preview**):

| Nama | Isi |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://nphecqbddkawstxehbyv.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key Supabase Anda |
| `VITE_SUPABASE_PROJECT_ID` | `nphecqbddkawstxehbyv` |
| `SUPABASE_URL` | sama dengan `VITE_SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` | sama dengan publishable key |
| `SUPABASE_PROJECT_ID` | `nphecqbddkawstxehbyv` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key dari Supabase Anda (rahasia) |
| `SHOPEE_PARTNER_ID` | Partner ID Shopee Open Platform |
| `SHOPEE_PARTNER_KEY` | Partner Key Shopee Open Platform |
| `GOOGLE_DRIVE_API_KEY` | API key Google Drive (foto garapan) |


Nilai dari dashboard Vercel selalu menang atas isi berkas di repo, jadi Anda
tetap bisa menimpanya kapan saja.

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
- Penutupan project otomatis 48 jam setelah pickup: tambahkan juga Vercel Cron
  yang memanggil `POST /api/public/hooks/sync-projects` setiap jam dengan
  header yang sama. (Penjadwal bawaan database sengaja tidak disertakan di
  `schema.sql` karena menunjuk alamat Lovable.)

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
