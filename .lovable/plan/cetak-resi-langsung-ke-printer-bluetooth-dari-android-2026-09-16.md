# Cetak resi langsung ke printer Bluetooth dari Android

## Tujuan
Dari webapp, tombol "Lihat Resi" menampilkan dua tombol: **Download Resi** (seperti sekarang) dan **Cetak** yang mengirim resi langsung ke printer termal portabel lewat Bluetooth, tanpa aplikasi tambahan. Ukuran kertas printer (58mm / 80mm / lainnya) diatur di menu Pengaturan. Berlaku untuk resi manual aplikasi dan label Shopee yang sudah diimpor.

## Cara kerja
- Browser Chrome Android bisa bicara langsung ke printer termal Bluetooth (protokol ESC/POS) lewat Web Bluetooth. Kamera/Bluetooth butuh HTTPS — aplikasi sudah HTTPS.
- Resi digambar ke kanvas sesuai lebar kertas, lalu dikonversi jadi gambar hitam-putih dan dikirim ke printer sebagai perintah cetak gambar.
- Label Shopee (PDF tersimpan di database) dirender ke gambar dengan pdf.js, lalu dicetak dengan cara yang sama.
- **Batasan:** hanya jalan di Chrome/Edge Android dan hanya printer Bluetooth Low Energy (BLE) — mayoritas printer termal portabel 58/80mm modern BLE, tapi printer Bluetooth klasik (SPP) tidak bisa diakses browser. Di iPhone atau printer non-BLE, tombol Download tetap dipakai.

## Implementasi
1. **Pengaturan printer** — halaman baru `/settings/printer` di menu Pengaturan: pilihan lebar kertas (58mm / 80mm / custom mm), kepekatan cetak, tombol "Tes Cetak" dan "Hubungkan Printer". Disimpan per-perangkat (localStorage) karena printer milik ponsel masing-masing, ditambah coba pakai izin Bluetooth yang tersimpan (`navigator.bluetooth.getDevices`) agar tak pairing ulang tiap kali.
2. **Mesin cetak** `src/lib/thermal-print.ts`:
   - Koneksi Web Bluetooth (layanan BLE printer termal umum: 0xFF00 / 0x18F0), pengiriman data per-blok kecil sesuai batas MTU.
   - Renderer kanvas resi mengikuti tata letak resi 100x100mm yang ada, diskalakan ke lebar kertas terpilih; dithering hitam-putih; kirim perintah raster `GS v 0`.
   - Fungsi cetak PDF Shopee: render halaman PDF via pdf.js → kanvas → raster → cetak (halaman 100x100mm Shopee pas untuk label).
3. **Tombol Cetak**:
   - `status.tsx` (dialog Preview Resi): tombol "Cetak" di samping "Download Resi PDF".
   - `orders.tsx`: ikon printer resi manual membuka dialog preview yang sama (berisi Download + Cetak); untuk resi Shopee ditambah tombol Cetak di samping tombol buka PDF.
   - Dialog preview diekstrak jadi komponen bersama `src/components/ResiPreviewDialog.tsx` agar dipakai di kedua halaman.
4. **Pesan galat ramah**: Bluetooth tidak tersedia / printer non-BLE / gagal kirim → pesan bahasa Indonesia yang menyarankan pakai Download.

## Verifikasi
- Build sukses.
- Halaman pengaturan printer menyimpan lebar kertas; tes cetak mengirim data ke printer (uji manual di Android).
- Tombol Cetak di preview resi dan resi Shopee memicu dialog pasangkan printer Chrome lalu mengirim data.
