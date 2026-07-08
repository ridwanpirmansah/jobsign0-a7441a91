## 1. Fix Duplikat Project saat Buat Order Baru

**Penyebab**: Saat order dibuat dengan status `active`, trigger `sync_order_to_project` langsung membuat project dengan code = `order_no` (karena items belum ada). Setelah itu items disimpan dan trigger `sync_item_to_project` membuat project per-item (`order_no-1`, `order_no-2`, dst). Hasilnya project pertama (code = order_no) selalu tersisa sebagai duplikat.

**Solusi (migrasi SQL)**: Ubah `sync_item_to_project` agar, saat item pertama diproses, membersihkan project header yang dibuat oleh `sync_order_to_project` (project dengan `parent_order_id = ord.id` dan `code = ord.order_no` yang belum memiliki `job_logs`), lalu detach `orders.project_id`. Hasil: order tanpa items tetap punya 1 project (legacy path); order dengan items hanya punya project per-item, tidak duplikat.

## 2. Fitur Tracking Paket + Role Kurir

### Database (migrasi)
- Tambah kolom `orders.no_resi TEXT`, `orders.ekspedisi TEXT`, `orders.ready_pickup_at TIMESTAMPTZ`, `orders.picked_up_at TIMESTAMPTZ`, `orders.picked_up_by UUID` (references profiles).
- Tambah enum value `'kurir'` ke `app_role`.
- Tabel baru `public.shipment_events` (order_id, event `ready_pickup|picked_up`, actor_id, note, created_at) untuk histori scan.
- RLS: staff (admin/owner) full akses, kurir bisa SELECT orders dengan `ready_pickup_at IS NOT NULL AND picked_up_at IS NULL` atau yang dia sudah pickup; INSERT event untuk dirinya sendiri.
- Fungsi `mark_ready_pickup(_order_id)` (staff) & `courier_pickup(_no_resi)` (kurir) — set timestamp + insert event.

### UI
- **Form Order** (`orders.tsx`): tambah input **No Resi** & **Ekspedisi** (JNE / J&T / SiCepat / Anteraja / Ninja / Pos / Lainnya) di section header.
- **Halaman Orders**: tombol "Tandai Siap Pickup" untuk order status `active` yang punya no_resi. Badge status pengiriman (Belum siap / Siap pickup / Sudah diambil).
- **Halaman Kurir baru** `/me/pickup`: daftar paket siap pickup (grouped by ekspedisi), tombol scan/input no resi untuk konfirmasi pickup. Lihat riwayat pickup.
- **Sidebar**: menu "Pickup Paket" muncul untuk role kurir.
- **User management** (`users.tsx`): tambahkan opsi role `kurir`.

### File yang diubah/ditambah
- Migrasi baru untuk schema + fungsi + RLS
- `src/routes/_authenticated/orders.tsx` — input resi/ekspedisi + tombol mark ready
- `src/routes/_authenticated/me.pickup.tsx` — halaman baru kurir
- `src/components/AppSidebar.tsx` — menu kurir
- `src/routes/_authenticated/users.tsx` — role kurir
- `src/hooks/useCurrentUser.ts` & `useAuth.tsx` — tambahkan role `kurir`
- `src/lib/orders.functions.ts` — extend schema resi/ekspedisi + server fn pickup

Setelah plan disetujui, migrasi dijalankan lebih dulu (approval user), lalu kode UI diupdate menyesuaikan tipe baru.