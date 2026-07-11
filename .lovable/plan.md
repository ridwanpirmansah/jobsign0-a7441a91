## Restore Data Order Historis

Import 333 baris orderan dari `RESTORE_DATA_BELANJA-2.xlsx` ke tabel `orders`.

### Yang akan diimpor per baris
- **Source** — SHOPEE/DIRECT/TIKTOK (di-lowercase → `shopee` / `direct` / `tiktok`)
- **co_date** ← kolom `tanggal`
- **username** ← kolom `Username`
- **kota** ← kolom `Kota`
- **text_neon** ← kolom `Text Neon`
- **status** — `Retur`/`retur` → `return`, sisanya (`aktif`) → `active`
- **akrilik_p** ← `Panjang`, **akrilik_l** ← `Lebar`
- **led_meter** ← `Panjang Led`
- **titik** ← `Titik`
- **payment** ← `Payment`, **split** ← `Split`
- **order_no** ← kolom nomor asli (1–352)

Kolom lain (adaptor, modul, socket_dc, kabel_meter, dst.) dibiarkan default agar trigger `calc_order_costs` menghitung HPP otomatis dari `material_prices`. Field turunan (`hpp`, `profit`, `led_cost`, dst.) akan otomatis dihitung ulang.

### Penomoran order
- Angka nol tidak diubah: nomor 1–352 dipakai apa adanya.
- **Tidak ada bentrok dengan data existing** — nomor aktif di DB saat ini mulai dari 354.
- **1 duplikat terdeteksi**: nomor `308` muncul 2× (silapoenyare 24-Apr & zahra_net 2-Mei). Baris kedua (tanggal lebih baru) diberi suffix → `308A`. Aturan yang sama otomatis dipakai jika ada duplikat lain (B, C, dst.).

### Menghindari trigger `assign_order_no` menimpa nomor
Trigger `assign_order_no` di-BYPASS dengan cara insert lewat `ALTER TABLE ... DISABLE TRIGGER assign_order_no_trg` di dalam satu transaksi, insert 333 baris, lalu enable kembali. Trigger `calc_order_costs` (untuk hitung HPP) tetap aktif.

### Langkah eksekusi
1. Baca ulang Excel → normalisasi tipe (angka, tanggal ISO, string trim).
2. Deteksi duplikat `no`, urutkan by tanggal, tambahkan suffix huruf pada baris ke-2+.
3. Bangun payload JSON 333 rows dengan `created_by = NULL` (data historis, bukan milik user tertentu).
4. Panggil `supabase--insert` sekali (satu SQL transaksi):
   - `ALTER TABLE orders DISABLE TRIGGER trg_assign_order_no;`
   - `INSERT INTO orders (source, status, order_no, co_date, username, kota, text_neon, akrilik_p, akrilik_l, led_meter, titik, payment, split) VALUES (...) x333;`
   - `ALTER TABLE orders ENABLE TRIGGER trg_assign_order_no;`
5. Verifikasi jumlah baris masuk dan spot-check 3 baris (pertama, terakhir, duplikat 308/308A).

### Catatan
- Semua orderan diberi status `active` (schema tidak punya status `completed`; `active` adalah status "berjalan/selesai normal" yang tetap muncul di laporan omzet/profit).
- Data historis ini tidak ikut sistem project/job_logs (tidak ada items) — hanya muncul di daftar order & laporan finansial.
