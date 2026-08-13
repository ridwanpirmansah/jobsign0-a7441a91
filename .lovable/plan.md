## Tujuan

Menambahkan **cadangan otomatis ke project Supabase kedua** (di luar Lovable Cloud) agar data webapp bisa disalin secara berkala dan bisa di-restore jika diperlukan.

## Yang perlu Anda siapkan

1. Project Supabase kedua (bisa gratis atau berbayar di Supabase) dengan **schema tabel yang sama** seperti project utama.
2. URL project kedua dan **Service Role Key**-nya. Kredensial ini akan disimpan sebagai secret backend, tidak ditampilkan di frontend.

## Yang akan dibangun

### 1. Konfigurasi target backup
- Dua secret backend: `BACKUP_SUPABASE_URL` dan `BACKUP_SUPABASE_SERVICE_ROLE_KEY`.
- Tabel `backup_runs` untuk mencatat: waktu mulai, waktu selesai, status (running/success/failed), jumlah baris, dan pesan error jika gagal.

### 2. Server function backup (khusus owner/admin)
- `testBackupConnection`: cek apakah project kedua bisa dijangkau.
- `runBackupToSupabase`: salin seluruh tabel yang sudah ada di daftar backup (`BACKUP_TABLES`) ke project kedua.
  - Mengikuti urutan tabel agar relasi antar data tidak bermasalah.
  - Membaca data per halaman (pagination) dari project utama lalu upsert ke project kedua berdasarkan kolom conflict yang sama.
  - Mencatat hasilnya di `backup_runs`.

### 3. Endpoint cron publik
- Route `/api/public/hooks/backup-to-supabase` yang menerima POST dengan verifikasi `apikey` (sama seperti cron Google Sheets / Shopee yang sudah ada).
- Endpoint ini bisa dipanggil oleh scheduler eksternal (pg_cron, cron-job.org, dll) untuk menjalankan backup otomatis tanpa login.

### 4. UI di halaman Backup
- Tambahkan bagian **"Backup ke Supabase Lain"** di `/owner/backup`:
  - Tombol **Test Koneksi**.
  - Tombol **Jalankan Backup Sekarang**.
  - Tabel riwayat `backup_runs` (waktu, status, jumlah baris).
  - Petunjuk cara mengatur cron otomatis.

## Detail teknis

- Client ke project kedua dibuat di dalam handler server function dengan `createClient` dari `@supabase/supabase-js`, bukan di module scope, supaya kredensial tidak bocor ke client bundle.
- Backup menggunakan service role key project kedua, sehingga RLS di project kedua tidak menghalangi proses upsert.
- Data di project kedua di-update/insert dengan `upsert(..., { onConflict })` sesuai konfigurasi `BACKUP_TABLES` yang sudah ada.
- Endpoint cron memvalidasi header `apikey` terhadap `SUPABASE_PUBLISHABLE_KEY` environment variable.
- Server function `runBackupToSupabase` memeriksa role owner/admin melalui `user_roles` sebelum mengeksekusi.

## Batasan

- Ini adalah **backup periodik**, bukan replika real-time atau failover otomatis.
- File di Storage (foto, PDF, dll) **tidak ikut** tersalin secara otomatis; yang dicadangkan hanya data tabel.
- Data auth/users (tabel `auth.users`) tidak ikut tersalin karena dikelola Supabase Auth. Setelah restore ke project baru, user perlu dibuat ulang atau diatur ulang.
- Project kedua harus sudah memiliki tabel dan kolom yang identik. Backup tidak membuat schema baru.

## Urutan pengerjaan

1. Tambahkan tabel `backup_runs` (migrasi + GRANT + RLS).
2. Minta dan simpan secret `BACKUP_SUPABASE_URL` serta `BACKUP_SUPABASE_SERVICE_ROLE_KEY`.
3. Buat server function `testBackupConnection` dan `runBackupToSupabase`.
4. Buat route cron `/api/public/hooks/backup-to-supabase`.
5. Tambahkan UI di `/owner/backup` untuk test, jalankan manual, dan lihat riwayat.
