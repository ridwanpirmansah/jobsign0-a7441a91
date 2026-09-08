# Satu Berkas SQL Bersih (Snapshot Database), Bukan Tumpukan Riwayat

## Kenapa `all_migrations.sql` gagal

Berkas itu adalah gabungan 81 langkah perubahan yang dibuat berurutan selama berbulan-bulan. Isinya penuh langkah yang saling menimpa: tabel dibuat, lalu diubah, lalu kolom ditambah, ada yang dihapus. Kalau satu langkah di tengah berhenti karena error, sisa langkah setelahnya ikut kacau — itulah pesan-pesan "already exists" dan "column does not exist" yang Anda lihat. Sekali gagal di tengah, database jadi setengah jadi dan setiap percobaan ulang menghasilkan error baru.

## Jawaban untuk pertanyaan "koneksikan Lovable ke Supabase saya"

Tidak bisa. Project ini memakai Lovable Cloud, dan backend-nya tidak dapat dipindah atau diarahkan ke akun Supabase pribadi. Jadi jalannya tetap: bangun struktur database di Supabase Anda dari satu berkas SQL, lalu isi datanya.

## Rencana yang jauh lebih mudah

Alih-alih memutar ulang seluruh riwayat, saya buat **satu berkas potret kondisi database saat ini** — persis seperti struktur yang sedang berjalan sekarang, tanpa langkah-langkah lama yang saling menimpa. Berkas ini dijalankan **sekali** di database yang **masih kosong**, dan urutannya sudah benar dari awal (tipe data dulu, lalu tabel, lalu fungsi, trigger, izin akses, dan aturan keamanan).

Langkah yang saya kerjakan:

1. Membaca struktur database yang sedang berjalan: semua tipe khusus, tabel beserta kolom dan nilai bawaan, kunci utama dan relasi antar tabel, fungsi database, trigger, hak akses, dan seluruh aturan keamanan baris.
2. Menyusunnya menjadi satu berkas baru `supabase/schema.sql` dengan urutan yang aman, plus data awal yang memang harus ada (daftar harga bahan, ekspedisi, tarif borongan, setelan absensi).
3. Menambahkan catatan di awal berkas: **jalankan hanya di project Supabase yang benar-benar baru/kosong**.
4. Memperbarui `DEPLOY.md`: langkah "jalankan all_migrations.sql" diganti menjadi "jalankan schema.sql sekali", lengkap dengan cara mengosongkan ulang database bila Anda sudah terlanjur menjalankan berkas lama (satu perintah reset schema).
5. `supabase/all_migrations.sql` dihapus supaya tidak membingungkan; folder `supabase/migrations` tetap dipertahankan sebagai catatan riwayat.

## Yang perlu Anda lakukan setelah itu

1. Karena percobaan sebelumnya sudah membuat sebagian tabel, database Supabase Anda perlu dikosongkan dulu. Cara paling bersih: buat project Supabase baru, atau jalankan satu perintah reset yang saya sertakan di DEPLOY.md.
2. Salin seluruh isi `supabase/schema.sql`, tempel ke SQL Editor, klik Run sekali.
3. Lanjutkan seperti panduan: aktifkan login Google, isi environment variable di Vercel, redeploy, lalu impor data lewat menu Backup.

## Catatan teknis

- Snapshot dibuat dari katalog Postgres project ini (`pg_catalog` / `information_schema`) melalui query baca-saja, bukan menyalin ulang berkas migrasi.
- Cakupan: `CREATE TYPE` untuk 9 enum, `CREATE TABLE` untuk seluruh tabel schema `public` beserta default dan constraint, `CREATE FUNCTION` untuk seluruh fungsi (termasuk penanda `security definer` dan `search_path`), `CREATE TRIGGER`, `GRANT` untuk `anon`/`authenticated`/`service_role` sesuai kondisi sekarang, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, dan seluruh `CREATE POLICY`.
- Penjadwal otomatis (pg_cron) yang menunjuk alamat Lovable tetap dinonaktifkan; penggantinya Vercel Cron seperti sudah tertulis di DEPLOY.md.
- Tidak ada perubahan apa pun pada database maupun kode webapp yang berjalan di Lovable.
