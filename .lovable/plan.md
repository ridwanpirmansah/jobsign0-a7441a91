# Rapikan Cetak Resi dan Jadikan Setelan Bersama

## Hasil yang akan dibuat
- Resi Shopee otomatis dipotong dari ruang putih berlebih, diperkecil ke area cetak nyata printer, lalu diberi batas aman agar sisi kanan tidak terpotong.
- Resi bawaan dirender ulang sebagai gambar hitam-putih dengan ukuran huruf dan jarak yang proporsional, teks panjang dibungkus, dan barcode selesai dimuat sebelum dikirim ke printer.
- Data yang dikirim ke printer tetap berupa gambar raster tetap (setara PNG), bukan perintah teks printer, sehingga tampilan konsisten. Tombol Download tetap menghasilkan berkas aslinya.
- Pengaturan ukuran kertas dan kepekatan disimpan sebagai pengaturan bersama. Pemilik/admin mengubah sekali, lalu seluruh pengguna memakai nilai yang sama saat mencetak.

## Perubahan tampilan
- Halaman Pengaturan Printer memuat nilai bersama dari server dan memakai tombol Simpan yang jelas.
- Tambahkan keterangan area cetak nyata: 58 mm memakai 384 titik dan 80 mm memakai 576 titik.
- Tes cetak memakai ukuran dan batas aman yang sama dengan resi sebenarnya.

## Detail teknis
- Tambahkan tabel singleton `printer_settings` dengan akses baca untuk pengguna login dan akses ubah hanya admin/owner, termasuk `GRANT` dan RLS.
- Tambahkan fungsi server untuk membaca/menyimpan setelan tanpa menaruh kunci rahasia di aplikasi.
- Ubah renderer ESC/POS menjadi async, tunggu gambar barcode selesai, auto-crop tepi putih label Shopee, lalu fit-center ke lebar titik printer dengan inset aman.
- Sertakan pengaturan printer dalam backup/restore dan snapshot pemasangan server sendiri.
- Verifikasi build, halaman pengaturan, preview resi, dan hasil raster pada ukuran 58/80 mm.
