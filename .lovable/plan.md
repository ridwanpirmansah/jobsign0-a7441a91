## Tujuan

Menarik data pesanan dari toko Shopee Anda secara otomatis, lalu membuat order baru di webapp (source = `shopee`) yang tetap bisa diedit manual dan otomatis ikut terhitung di Laporan Keuangan.

## Yang perlu Anda siapkan (di luar Lovable)

Shopee belum tersedia sebagai konektor siap pakai di Lovable, jadi integrasinya dibuat custom ke **Shopee Open Platform API v2**. Yang dibutuhkan:

1. Daftar akun di https://open.shopee.com (Open Platform Indonesia).
2. Buat App → dapatkan **Partner ID** dan **Partner Key**.
3. Isi **Redirect URL** di aplikasi Shopee dengan URL callback dari webapp ini (saya siapkan di langkah implementasi, formatnya `https://job.lintangsemesta.com/api/public/shopee/callback`).
4. Otorisasi toko Anda ke App tersebut (sekali klik dari halaman pengaturan di webapp).

Catatan penting: app baru di Shopee biasanya mulai di mode **Sandbox/Test**, dan butuh review Shopee sebelum bisa akses toko live. Waktu approval bervariasi (beberapa hari sampai beberapa minggu) dan itu di luar kendali Lovable. Selama menunggu, halaman sync akan menampilkan status "belum terotorisasi".

## Yang akan dibangun

### 1. Penyimpanan kredensial & token
- Partner ID + Partner Key disimpan sebagai secret backend (tidak pernah tampil di frontend).
- Tabel baru `shopee_settings` (single row) untuk: `shop_id`, `access_token`, `refresh_token`, `token_expires_at`, `enabled`, status sync terakhir (mirip pola `sync_settings` yang sudah ada).
- Tabel `shopee_order_map` untuk memetakan `order_sn` Shopee → `order_id` di webapp, supaya sync ulang tidak membuat duplikat.

### 2. Alur otorisasi toko
- Halaman baru `/owner/shopee` (khusus owner/admin): tombol "Hubungkan Toko Shopee" → redirect ke halaman consent Shopee.
- Route callback publik `/api/public/shopee/callback` menukar `code` jadi access/refresh token dan menyimpannya.
- Refresh token otomatis diperbarui sebelum kedaluwarsa (access token Shopee berumur ±4 jam).

### 3. Tarik pesanan
- Server function `syncShopeeOrders`: panggil `order/get_order_list` (filter rentang tanggal + status) lalu `order/get_order_detail` untuk detail.
- Mapping ke tabel `orders` yang ada:
  - `source` = `shopee`
  - `username` = buyer username, `kota` = kota penerima
  - `co_date` = tanggal checkout
  - `text_neon` = nama produk (bisa diedit manual)
  - `payment` = total harga pesanan, `paket` = nama paket/variasi
  - `no_resi` + `ekspedisi` = tracking number & kurir dari Shopee (jika sudah ada)
  - `notes` = catatan pembeli + `order_sn` Shopee sebagai referensi
- Field produksi (akrilik P/L, LED, titik, dll.) dibiarkan default 0 agar Anda isi/edit manual seperti biasa — HPP & profit tetap dihitung trigger yang sudah ada.
- Sinkron ulang: order yang sudah pernah masuk hanya di-update pada field aman (status, no_resi, ekspedisi), tidak menimpa hasil editan manual Anda.

### 4. Halaman pengaturan `/owner/shopee`
- Status koneksi toko + tombol putuskan/hubungkan ulang.
- Pilih rentang tanggal & status pesanan yang ditarik.
- Tombol **"Tarik Pesanan Sekarang"** + tampilan hasil (X baru, Y diperbarui, Z dilewati).
- Opsi sync otomatis tiap jam (mengikuti pola cron yang sudah dipakai sync Google Sheets).
- Preview daftar pesanan sebelum diimport, dengan centang per baris supaya Anda bisa pilih yang mana saja yang jadi order.

### 5. Laporan
Karena order masuk ke tabel `orders` dengan `payment` terisi, omzet Shopee otomatis muncul di halaman Laporan Keuangan tanpa perubahan tambahan.

## Detail teknis

- Semua panggilan Shopee dilakukan di server (`createServerFn` + helper `*.server.ts`), tidak pernah dari browser.
- Signature Shopee v2 (HMAC-SHA256 dari `partner_id + path + timestamp + access_token + shop_id`) dibuat dengan modul `crypto` bawaan — kompatibel dengan runtime server yang dipakai.
- Route callback ditaruh di `src/routes/api/public/shopee/callback.ts` dan memvalidasi `shop_id` + state sebelum menyimpan token.
- Akses halaman & server function dibatasi role owner/admin, sesuai pola `sync.functions.ts`.
- Migrasi database menyertakan GRANT + RLS untuk tabel baru.

## Urutan pengerjaan

1. Migrasi tabel `shopee_settings` + `shopee_order_map`.
2. Minta secret Partner ID & Partner Key.
3. Bangun otorisasi OAuth + callback (agar Anda bisa dapat URL Redirect untuk didaftarkan di Shopee).
4. Bangun sync pesanan + mapping ke `orders`.
5. Halaman `/owner/shopee` dengan preview, import terpilih, dan sync otomatis.
