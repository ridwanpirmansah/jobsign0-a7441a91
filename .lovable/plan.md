# Impor otomatis resi Shopee

## Tujuan
Saat order Shopee diimpor atau disinkronkan, webapp langsung menyelesaikan proses pengaturan pengiriman yang masih diperlukan, meminta Shopee membuat label, lalu menyimpan PDF label ke data order. Preview/print setelah itu hanya membaca PDF tersimpan dan tidak lagi meminta label ke Shopee.

## Implementasi
- Perluas alur impor Shopee untuk memeriksa status dan parameter pengiriman setiap pesanan.
- Untuk pesanan yang belum diatur pengirimannya, panggil proses `ship_order` dengan opsi logistik valid dari Shopee sebelum meminta dokumen label.
- Setelah tracking/label tersedia, buat dan unduh shipping document, lalu simpan base64 PDF ke `orders.shopee_label_pdf` pada transaksi impor yang sama.
- Terapkan alur yang sama pada import terpilih dan sinkronisasi otomatis, dengan perilaku idempoten untuk order/label yang sudah pernah diproses.
- Catat kegagalan pengaturan pengiriman atau impor PDF per order pada hasil sinkronisasi tanpa membatalkan order lain.
- Ubah endpoint preview/print agar hanya mengembalikan PDF yang sudah tersimpan; bila belum ada, tampilkan pesan bahwa label belum berhasil diimpor dan minta sinkronisasi ulang—tanpa fallback request ke Shopee.

## Verifikasi
- Pastikan build tetap berhasil.
- Uji bahwa order Shopee yang sudah memiliki `shopee_label_pdf` dapat dipreview dari salinan lokal.
- Pastikan order tanpa PDF tidak memicu API Shopee dari tombol preview/print.
