# Satu Berkas SQL untuk Import Sekaligus ke Supabase Sendiri

Tujuan: Anda tidak perlu menjalankan 21 berkas migrasi satu per satu di SQL Editor Supabase. Cukup satu berkas gabungan yang di-copy-paste sekali.

## Yang saya kerjakan

1. Membuat berkas `supabase/all_migrations.sql` — gabungan seluruh isi folder `supabase/migrations/` berurutan sesuai tanggal pada nama berkas, dengan pemisah komentar per berkas agar mudah dilacak bila ada error.
2. Memperbarui `DEPLOY.md` bagian "Siapkan project Supabase sendiri": langkah menjalankan migrasi satu per satu diganti menjadi cukup buka `supabase/all_migrations.sql`, salin seluruh isinya, tempel ke SQL Editor, lalu Run sekali.
3. Menambahkan catatan di `DEPLOY.md`: bila nanti ada migrasi baru dari Lovable, jalankan hanya berkas migrasi baru tersebut (berkas gabungan tidak perlu dijalankan ulang karena sebagian besar perintah sudah memakai `IF NOT EXISTS`, namun menjalankan ulang tetap aman untuk berkas lama dan akan error di bagian yang tidak idempoten — cukup lanjutkan dari berkas yang belum pernah dijalankan).

## Yang tetap sama

- Tidak ada perubahan kode aplikasi, skema database, maupun perilaku webapp di Lovable.
- Berkas migrasi asli di `supabase/migrations/` tetap dipertahankan apa adanya (dibutuhkan untuk mencatat migrasi baru ke depan).

## Catatan penggunaan

- Ukuran berkas gabungan cukup besar; jalankan dalam satu kali Run di SQL Editor. Jika SQL Editor memotong berkas terlalu besar, alternatifnya: jalankan per separuh bagian (pemisah komentar per berkas memudahkan memotong).
- Setelah selesai, lanjutkan ke langkah berikutnya di `DEPLOY.md` (aktifkan login Google, isi environment variable di Vercel, redeploy).
