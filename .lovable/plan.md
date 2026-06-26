# Ganti `print_cost` + `karet_seal` → `biaya_lainnya` (1% HPP)

## Tujuan

Hilangkan komponen biaya **Print** dan **Karet Seal** di seluruh aplikasi, ganti satu komponen baru **"Biaya Lainnya"** sebesar **1% dari HPP dasar** (HPP tanpa biaya lainnya itu sendiri). Komponen ini muncul di **Kalkulasi Live** di form popup Order sehingga angka HPP di popup = HPP di tabel orderan.

## 1. Migration database

- `ALTER TABLE public.orders` → tambah kolom `biaya_lainnya numeric NOT NULL DEFAULT 0`, lalu `DROP COLUMN print_cost`, `DROP COLUMN karet_seal`.
- Bersihkan key terkait di `material_prices`: hapus row `print_default` dan `karet_seal_default` (jika ada).
- Update trigger `calc_order_costs`:
  - Hilangkan `print_cost` & `karet_seal` dari hitungan.
  - Hitung `base_hpp` = jumlah semua komponen (LED, akrilik, solder, tempel, kabel, kabel_socket, adaptor, modul, socket_dc, baut_fischer, outdoor_cost).
  - `NEW.biaya_lainnya := ROUND(base_hpp * 0.01)`.
  - `NEW.hpp := base_hpp + NEW.biaya_lainnya`.
  - `NEW.profit := payment + split − hpp` (tetap).

## 2. Frontend — `src/routes/_authenticated/orders.tsx`

- Hapus field & input UI `print_cost` dan `karet_seal` dari `FormState`, `emptyForm`, `toForm`, dan grid biaya manual.
- Hapus key-nya di payload save.
- Update fungsi `calc` (live preview) supaya identik dengan trigger:
  - Hitung `base_hpp` tanpa print/karet.
  - `biaya_lainnya = Math.round(base_hpp * 0.01)`.
  - `hpp = base_hpp + biaya_lainnya`.
- Tampilkan baris baru **"Biaya Lainnya (1% HPP)"** di panel "Kalkulasi Live" tepat di atas baris HPP.

## 3. Schema server function — `src/lib/orders.functions.ts`

- Ganti field `print_cost` / `karet_seal` di Zod schema dengan `biaya_lainnya: z.number().min(0).default(0).optional()` (nilai server tetap dihitung trigger; field opsional supaya kompatibel).
- Hapus keduanya dari objek insert/update yang dikirim ke Supabase.

## 4. Owner analytics — `src/routes/_authenticated/owner.analytics.tsx`

- Ganti kolom select `print_cost,karet_seal` → `biaya_lainnya`.
- Ganti dua entry breakdown `{ k: "print_cost", name: "Print" }` dan `{ k: "karet_seal", name: "Karet Seal" }` menjadi satu entry `{ k: "biaya_lainnya", name: "Biaya Lainnya" }`.

## 5. PDF/laporan lain

Tidak ada referensi `print_cost`/`karet_seal` di payroll-pdf atau reports — tidak perlu diubah. Setelah migrasi, `src/integrations/supabase/types.ts` di-regenerate otomatis.

## Verifikasi

- Buka order existing → angka HPP di popup form (Kalkulasi Live) **persis sama** dengan kolom HPP di tabel.
- Buat order baru, ubah angka LED/akrilik/dll → baris "Biaya Lainnya (1% HPP)" ikut berubah real-time; setelah save, nilai HPP tabel = nilai HPP yang tadi terlihat di popup.
- Halaman Owner Analytics → breakdown biaya menampilkan "Biaya Lainnya" sebagai pengganti Print & Karet Seal, tanpa error.
