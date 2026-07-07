## Fitur Multi-Item per Order

Satu nomor order bisa berisi banyak produk (custom neon + ready-stock). Payment/DP/split tetap 1x di level order. HPP order = jumlah HPP semua item. Setiap item custom otomatis jadi Project sendiri; item ready-stock tidak buat Project baru.

### 1. Database (migration baru)

**Tabel baru `public.order_items`** — satu baris per produk dalam order:
- `order_id` (FK orders, cascade delete), `position` (int, urutan tampilan)
- `kind`: `'custom'` | `'ready_stock_ref'` (pilih dari RS existing) | `'ready_stock_manual'` (ketik manual)
- **Custom fields** (dipindah dari `orders`): `text_neon`, `akrilik_p/l`, `led_meter`, `titik`, `kabel_meter`, `kabel_socket_meter`, `adaptor`, `adaptor_type`, `modul`, `socket_dc`, `baut_fischer`, `outdoor_cost`
- **Ready-stock ref**: `source_ready_stock_order_id` (FK orders id)
- **Ready-stock manual**: `manual_name`, `manual_price` (harga jual), `manual_hpp`
- **Hitung otomatis** (trigger): `led_cost, akrilik_cost, solder_cost, tempel_cost, kabel_cost, kabel_socket_cost, biaya_lainnya, item_hpp`
- `project_id` (FK projects, nullable — terisi untuk custom)
- `notes`, `created_at`, `updated_at`
- GRANT + RLS: authenticated bisa CRUD via order induknya (policy: order boleh dilihat/edit user).

**Perubahan `public.orders`:**
- Kolom neon lama tetap ada (dipakai legacy + agregat), tapi jadi hasil agregasi item — bukan input utama lagi.
- Trigger baru `aggregate_order_from_items()` (AFTER INSERT/UPDATE/DELETE pada `order_items`): update `hpp`, `titik`, `led_meter`, dan `text_neon` (concat "TEXT1 | TEXT2 | …" atau "3 produk" bila banyak) di order induk, lalu `profit = payment+split - hpp`.
- Trigger existing `calc_order_costs` di orders tetap dipakai untuk order tanpa items (backward compat) dan hanya menghitung repair_cost & biaya_lainnya. Ketika ada items, agregasi item yang menang.
- Trigger `sync_order_to_project` diganti: untuk tiap item `kind='custom'`, buat/update Project dengan `code = order_no || '-' || position` (mis. `123-1`, `123-2`); simpan `total_points = item.titik`, `contract_value` = proporsi payment berdasarkan HPP (atau kosongkan — user hanya butuh lihat "order induk mana"). Ready-stock ref/manual tidak membuat Project baru.

**Migrasi data lama** (idempotent):
- Untuk setiap `orders` yang belum punya `order_items`: buat 1 baris `order_items` (position=1, kind='custom') menyalin semua kolom neon; hubungkan `project_id` ke project existing. Jalankan trigger agregasi.

### 2. Backend server functions

`src/lib/orders.functions.ts`:
- Tambah `listOrderItems({ orderId })`, `upsertOrderItem`, `deleteOrderItem`, `reorderOrderItems`.
- `listOrders` juga sertakan hitungan item + array ringkas item (untuk list view).
- `upsertOrder` tetap ada untuk header, tapi tidak lagi wajib mengisi field neon (dibuat nullable di zod schema).
- Tambah `listReadyStockAvailable()` untuk dropdown pemilihan RS.

### 3. UI `orders.tsx` (refactor form)

Form order jadi 2 bagian:

**Header** (atas): Sumber, Status, No. Order, Tanggal, Username, Kota, Payment, DP, Split, Notes.

**Items** (bawah): list card item + tombol "Tambah Produk".
- Tiap item punya toggle `Custom | Ready Stock | Manual`.
- **Custom**: full form neon existing (text_neon, akrilik, LED, titik, dst) + live preview HPP per-item.
- **Ready Stock**: dropdown daftar RS available (dari `listReadyStockAvailable`) → tampilkan nama/harga/HPP. Saat order disimpan aktif, RS yang dipilih auto ubah status → `sold` (atau flag `linked_order_id`).
- **Manual**: nama produk + harga jual + HPP.

Live total: HPP order = sum item, Profit = (payment+split) - HPP.

**List view orders**: kolom "Produk" tampilkan jumlah item + preview text_neon pertama ("Toko Bunga +2 lainnya"). Klik row → expand daftar item.

### 4. `projects/$id.tsx` (Detail Project)

Tambah card "Order Terkait" di atas:
- Nomor order, sumber, tanggal, customer, kota, payment order induk, link "Buka Order".
- Sudah menampilkan Karyawan Ditugaskan + Riwayat Job Log (existing) — kebutuhan user "lihat orderan mana + karyawan yang mengerjakan" terpenuhi.

### 5. Payroll & Slip PDF

Tidak berubah — payroll pakai `job_logs.project_id`, dan tiap item custom sudah punya Project sendiri. Slip PDF otomatis benar karena project code memuat nomor order induk.

### 6. Laporan (`reports.tsx`)

Tidak berubah signifikan: omzet tetap dari `orders.payment + split` (level header), HPP dari `orders.hpp` (hasil agregasi). Data tetap konsisten.

### File yang disentuh

- **baru**: `supabase/migrations/<ts>_order_items.sql`
- **edit**: `src/lib/orders.functions.ts` (schema + fn baru untuk items)
- **edit**: `src/routes/_authenticated/orders.tsx` (refactor besar: form multi-item + list expand)
- **edit**: `src/routes/_authenticated/ready-stock.tsx` (tetap pakai OrdersPage, tapi item RS tunggal juga masuk mekanisme baru)
- **edit**: `src/routes/_authenticated/projects.$id.tsx` (card Order Terkait)
- **edit**: `src/integrations/supabase/types.ts` (auto-regen setelah migration)

### Detail teknis penting

```text
orders (header)
  ├─ payment, dp, split, status, order_no       ← input user
  ├─ hpp, profit, titik, led_meter, text_neon   ← agregat dari items (trigger)
  └─ order_items[]
       ├─ kind='custom'          → buat Project code=<order_no>-<pos>
       ├─ kind='ready_stock_ref' → link RS existing, tidak buat project baru
       └─ kind='ready_stock_manual' → hanya nama/harga/HPP manual
```

Nomor order induk & nomor project sengaja tidak identik (sesuai keputusan Anda). Project code `<order_no>-<pos>` sekadar memudahkan telusur; kolom project baru bisa ditambahkan `parent_order_id` (opsional, mempermudah query "project ini dari order mana") — akan saya tambahkan sebagai FK nullable di project.

### Catatan risiko

- Refactor form `orders.tsx` besar (~600 baris). Saya akan pertahankan validasi & kalkulasi yang sudah jalan.
- Data lama akan otomatis dipindah ke `order_items` oleh migration. Sebaiknya **export/backup dulu** sebelum menjalankan migration ini (Cloud → Advanced → Export data).
