# Perbaikan Backup & Restore untuk Database Baru

## Tujuan

Restore memindahkan seluruh data operasional—karyawan, order, project, absensi,
garapan, pengiriman, dan lainnya—tanpa membawa akun login lama. Karyawan tetap
tersimpan, tetapi belum terhubung ke akun. Setelah karyawan mendaftar di sistem
baru, owner dapat menghubungkannya secara manual dari halaman Karyawan yang
sudah tersedia.

## Perubahan

1. **Pisahkan akun dari data operasional**
   - Restore Semua tidak mengimpor `profiles`, `user_roles`, dan
     `user_feature_permissions` dari database lama karena ID-nya terkait akun
     login di database lama.
   - Akun owner dan akun baru yang sudah ada di database tujuan tidak ditimpa.
   - Semua `employees.profile_id` dari backup diubah menjadi kosong sehingga
     data karyawan dapat masuk dan siap dihubungkan manual nanti.

2. **Bersihkan referensi akun lama secara otomatis**
   - Kosongkan referensi akun lama yang sifatnya opsional, seperti pembuat order,
     pemeriksa/pemberi persetujuan, pengambil paket, dan pelaku riwayat
     pengiriman.
   - Ini memperbaiki error `profiles_id_fkey` dan
     `shipment_events_actor_id_fkey` tanpa menghapus data bisnisnya.

3. **Restore dengan urutan relasi yang benar**
   - Masukkan master data dan karyawan terlebih dahulu, baru absensi, payroll,
     garapan, serta data turunannya.
   - Tangani hubungan melingkar Order–Project dalam dua tahap: masukkan order
     tanpa tautan project, masukkan project, lalu sambungkan kembali keduanya.
   - Dengan demikian `attendances_employee_id_fkey` dan relasi sejenis tidak
     gagal selama data karyawan memang ada di backup yang sama.

4. **Normalisasi backup versi lama**
   - Jika project lama tidak memiliki `title`, isi otomatis dari nama/deskripsi
     project, kode project, atau label aman `Project Lama`.
   - Abaikan kolom lama yang tidak dikenal dan pertahankan nilai bawaan database
     untuk kolom baru yang tidak terdapat di file lama.
   - Laporkan jumlah baris yang berhasil, dilewati, dan alasan data yang benar-
     benar tidak dapat dipulihkan.

5. **Perjelas tampilan Restore**
   - Jelaskan bahwa **Restore Semua (.zip)** adalah cara yang benar untuk
     memindahkan database lengkap karena relasi diproses berurutan.
   - Restore per tabel tetap tersedia untuk master/data mandiri; untuk tabel
     yang bergantung pada tabel lain, tampilkan pesan yang mudah dipahami bila
     data induknya belum dipulihkan.
   - Setelah selesai, ingatkan owner untuk meminta karyawan registrasi lalu
     menghubungkan akun mereka di halaman Karyawan.

6. **Dokumentasi dan verifikasi**
   - Perbarui `DEPLOY.md` dengan alur migrasi akun dan data.
   - Uji restore menggunakan data lama yang mencakup project tanpa judul,
     karyawan tanpa akun baru, absensi, dan riwayat pengiriman.
   - Pastikan data bisnis tampil, owner baru tetap dapat login, serta hubungan
     akun-karyawan dapat dibuat manual.

## Catatan teknis

Normalisasi dilakukan di server sebelum upsert dan dibatasi per tabel. Restore
ZIP dijadikan satu alur terkoordinasi agar urutan serta tahap penyambungan ulang
tidak bergantung pada perulangan dari browser. Tidak ada perubahan struktur
database dan webapp Lovable tetap memakai backend yang sekarang.
