## Dua fitur

### 1. Order bisa mengambil item dari Draft (mirip Ready Stock)

**Perubahan penomoran draft**
- Ubah trigger DB `assign_order_no`: draft yang belum di-link ke order dapat kode otomatis `DR-N` (mirip `RS-N`). Draft lama yang masih `order_no = '0'` di-backfill jadi `DR-1, DR-2, ...`.
- UI daftar Draft menampilkan kode `DR-xx` (bukan "0" lagi).

**Item kind baru: `draft_ref`**
- Tambah nilai baru pada dropdown "Tambah Produk" di form order: **"Ambil dari Draft"** (sebelah "Ambil dari Ready Stock"). Menampilkan daftar draft yang belum di-link ke order lain: kode `DR-xx`, judul, HPP, titik.
- Item `draft_ref` menyimpan `source_draft_order_id`. HPP-nya diambil dari HPP draft tersebut (sama pola dengan `ready_stock_ref` yang sudah ada).
- Trigger `calc_order_item_costs` diperluas untuk kind ini.

**Konversi draft saat order disimpan (bukan draft lagi)**
- Trigger baru `absorb_referenced_draft`: setelah `order_items` di-insert/update dengan `kind = 'draft_ref'` dan parent order berstatus `active/return/ready_stock`, draft yang dirujuk otomatis:
  - `status` → `active` (mengikuti parent) sehingga hilang dari halaman Draft dan tidak lagi muncul di picker draft.
  - `order_no` di-set mengikuti parent: `<parent.order_no>-D<position>` (mirip pola project child `ORD-1`).
  - `parent_order_id` di-set ke id order utama.
  - Proyek yang sudah ada dari draft tersebut di-relink ke parent (title & kode diikutkan) — memakai jalur `sync_order_to_project` yang sudah ada.
- Kalau item `draft_ref` di-hapus dari order, draft dikembalikan ke `status = 'draft'` dan `order_no` di-reset jadi `DR-N` baru.

**UI kecil**
- Header Draft di halaman `drafts.tsx` beri kalimat tambahan: "Draft yang sudah diambil oleh order aktif akan hilang dari sini."
- Ikon `FileEdit` / warna amber untuk item `draft_ref` di daftar produk dalam order.

**File yang tersentuh**
- Migration SQL: enum item kind + trigger `assign_order_no` + trigger `calc_order_item_costs` + trigger `absorb_referenced_draft` + backfill `DR-N`.
- `src/lib/orders.functions.ts`: tambah `listDraftAvailable`, perluas `itemSchema` menerima `source_draft_order_id` + kind `draft_ref`.
- `src/routes/_authenticated/orders.tsx`: tambah pilihan "Ambil dari Draft" di `ItemCard` (parallel dengan ready-stock).
- `src/routes/_authenticated/drafts.tsx`: kalimat penjelas (opsional).

### 2. Filter pengeluaran "Belum Dibayar" (hutang)

Dua-duanya diaktifkan seperti permintaan:

**A. Kartu KPI "Belum Dibayar" bisa diklik**
- Klik kartu → toggle mode filter "hutang saja". Kartu muncul dengan ring/glow orange saat aktif, klik lagi = matikan.
- Judul list berubah jadi "Riwayat Pengeluaran — Belum Dibayar" saat aktif; tombol "×" kecil untuk hapus filter.

**B. Kategori dropdown dapat opsi "Belum Dibayar"**
- Dropdown filter di header list ditambah section: `Semua Kategori`, **`● Belum Dibayar (hutang)`**, `● Sudah Lunas`, lalu daftar kategori.
- Pilihan status & kategori bekerja mandiri; bisa dikombinasikan (misal: filter kartu "Belum Dibayar" aktif + kategori "Iklan" = hutang iklan saja).

**Perilaku data**
- Filter hanya untuk tampilan list — KPI Total/PnL/HPP/Avg tetap dihitung dari seluruh periode agar konsisten. KPI "Belum Dibayar" tetap ringkasan periode.
- Kalau tidak ada baris cocok, tampil pesan "Tidak ada pengeluaran hutang pada periode ini."

**File yang tersentuh**
- `src/routes/_authenticated/owner.expenses.tsx`: state `payFilter: 'all' | 'hutang' | 'lunas'`, KPI card diberi `onClick`, dropdown diperluas, computed `filtered` menyaring dua sumbu (kategori + status), header list ditambah chip filter aktif + tombol reset.

### Catatan
- Tidak ada perubahan pada halaman lain, sidebar, atau permission — semua fitur di dalam alur yang sudah ada.
- Semua trigger DB pakai `SECURITY DEFINER` dengan `search_path` eksplisit sesuai pola project.
