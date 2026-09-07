# Migrasi ke Cloud Sendiri (di luar Lovable)

Tujuan: webapp tetap berjalan penuh meski akun Lovable turun ke Free / Cloud dihentikan, dengan frontend, database, dan integrasi Shopee berjalan di infrastruktur milik sendiri.

## Gambaran Arsitektur Saat Ini

- Frontend + backend: satu aplikasi TanStack Start (React), di dalamnya ada server function dan endpoint publik (`/api/public/hooks/sync-shopee`, `/api/public/shopee/callback`).
- Database: Lovable Cloud (Supabase). Seluruh skema tersimpan di `supabase/migrations/` (21 file) sehingga skema bisa dibangun ulang persis.
- Secret yang dipakai: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `GOOGLE_DRIVE_API_KEY`, `LOVABLE_API_KEY` (fitur AI), `SUPABASE_PUBLISHABLE_KEY` (proteksi endpoint cron).

## Langkah Migrasi

### 1. Amankan kode dan data (sebelum memutus Lovable Cloud)
- Hubungkan project ke GitHub (tombol GitHub di Lovable) agar seluruh kode + folder `supabase/migrations/` tersalin.
- Ekspor semua data: gunakan fitur Backup CSV di `/owner/backup` yang sudah ada, dan/atau saya buatkan skrip ekspor SQL lengkap semua tabel lewat tool database. Ini penting karena memutus Cloud bersifat permanen dan menghapus data.

### 2. Siapkan database baru (pilih salah satu)
- **Opsi A — Supabase Cloud (gratis, paling mudah):** buat project baru di supabase.com, terapkan semua file migrasi berurutan, lalu impor data dari hasil ekspor langkah 1.
- **Opsi B — Self-hosted Supabase (VPS + Docker):** untuk kontrol penuh, tapi butuh perawatan server sendiri.
- Rekomendasi: mulai dari Opsi A; pindah ke B kapan pun bisa karena formatnya sama.

### 3. Deploy aplikasi
- Deploy ke Cloudflare Workers (sesuai target template ini; ada tier gratis) atau VPS Node.js — ikuti panduan self-hosting: https://docs.lovable.dev/tips-tricks/self-hosting
- Isi environment variable di hosting baru: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `GOOGLE_DRIVE_API_KEY`.
- Arahkan domain `job.lintangsemesta.com` ke hosting baru.

### 4. Penyesuaian kode kecil (saya kerjakan di project ini sebelum pindah)
- Ganti klien Supabase bawaan Lovable (`src/integrations/supabase/*`) agar membaca env biasa, bukan konfigurasi Lovable Cloud.
- Fitur AI yang memakai `LOVABLE_API_KEY` tidak bisa dibawa keluar — diganti ke API key milik sendiri (misal OpenAI/Gemini) atau dimatikan.
- Pastikan tidak ada logika lain yang bergantung pada layanan internal Lovable.

### 5. Konfigurasi ulang integrasi eksternal
- **Auth Google:** tambahkan URL domain baru di konfigurasi OAuth Supabase baru.
- **Shopee:** ubah redirect URL OAuth ke `https://job.lintangsemesta.com/api/public/shopee/callback` di panel Shopee Open Platform, lalu hubungkan ulang toko.
- **Cron sinkronisasi Shopee:** pasang penjadwal eksternal (cron VPS / Cloudflare Cron / layanan cron gratis) yang memanggil `/api/public/hooks/sync-shopee` setiap jam.

### 6. Verifikasi sebelum memutus Lovable Cloud
- Uji login, buat order, import Shopee, print resi, absensi, laporan di deployment baru dengan data hasil impor.
- Setelah semua berjalan minimal beberapa hari, baru nonaktifkan/putus Lovable Cloud.

## Catatan Penting
- Memutus Lovable Cloud **tidak bisa dibatalkan** dan menghapus seluruh data — urutannya harus: ekspor dulu, deployment baru berjalan, baru putus.
- Selama masih memakai editor Lovable, Cloud tidak bisa dilepas dari project ini; migrasi berarti project berjalan di repo GitHub + hosting sendiri, dan perubahan selanjutnya dilakukan di repo tersebut.
- Biaya perkiraan: Supabase Cloud gratis (batas 500 MB database), Cloudflare Workers gratis untuk trafik kecil-menengah, VPS opsional mulai ±$5/bulan bila ingin self-host penuh.

## Technical Details
- Migrasi DB: `supabase/migrations/*.sql` dijalankan berurutan via `supabase db push` atau SQL editor.
- Ekspor data: `pg_dump`-style `COPY` per tabel via tool SQL, atau perluas `/owner/backup` agar mencakup semua tabel.
- File yang akan disesuaikan: `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-attacher.ts`, `auth-middleware.ts`, `src/lib/sheet-sync.server.ts` (AI key), `.env` (diganti env hosting).
- Tidak ada perubahan skema database.
