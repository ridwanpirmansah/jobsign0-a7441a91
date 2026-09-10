# Multi Akun Shopee

## Tujuan
Mendukung lebih dari satu toko Shopee terhubung sekaligus, sehingga order dari semua toko bisa diimport/disinkronkan ke halaman Orderan, masing-masing tetap memakai resi Shopee-nya sendiri.

## Perubahan yang akan dilakukan

### 1. Database
- Tabel baru `public.shopee_shops` (shop_id, nama toko, access_token, refresh_token, masa berlaku token, status aktif, waktu terhubung) dengan RLS + GRANT (akses hanya admin/owner lewat server function).
- Kredensial aplikasi (partner_id, partner_key, redirect_url, lookback_days, enabled, status sync terakhir) tetap di `shopee_settings` — dipakai bersama oleh semua toko.
- Migrasi otomatis: toko yang saat ini sudah terhubung di `shopee_settings` dipindahkan ke `shopee_shops` agar tidak perlu menghubungkan ulang.
- Tambah kolom `shopee_shop_id` pada `orders` untuk menandai order berasal dari toko mana.

### 2. Server (`src/lib/shopee.server.ts`)
- Refactor: fungsi yang selama ini membaca satu token dari settings menjadi menerima/memilih shop dari `shopee_shops` (dengan refresh token per toko).
- `runShopeeSync` dan `importSelected` mengulang semua toko aktif; hasil sync menjumlahkan inserted/updated/skipped dan mencatat error per toko tanpa membatalkan toko lain.
- Callback OAuth menyimpan toko baru ke `shopee_shops` (idempoten per shop_id — menghubungkan toko yang sama hanya memperbarui token).
- Import/preview order menandai toko asal dan menyimpan `shopee_shop_id` di order.

### 3. Halaman Integrasi Shopee (`owner.shopee.tsx`)
- Daftar toko terhubung: nama/shop_id, status token, tombol Putuskan per toko.
- Tombol "Tambah Toko Shopee" memakai alur OAuth yang sama, menambah toko ke daftar.

### 4. Dialog Import (`ShopeeImportDialog.tsx`)
- Preview pesanan menggabungkan semua toko, tiap baris diberi label nama toko.
- Badge toko juga ditampilkan pada order yang diimport bila lebih dari satu toko aktif.

### 5. Cron `sync-shopee`
- Hook publik tetap satu endpoint, di dalamnya menjalankan sync semua toko aktif.

## Verifikasi
- Build/typecheck sukses.
- Cek lint keamanan database untuk tabel baru.
- Toko lama tetap terhubung setelah migrasi; menambah toko kedua tidak merusak toko pertama.
