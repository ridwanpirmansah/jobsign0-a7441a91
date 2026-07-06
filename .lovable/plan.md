## Fitur Baru: Konsumsi Karyawan (Jajan/Makan Pakai Uang Perusahaan)

Catatan pembelian makan/jajan karyawan yang dibayar pakai uang perusahaan, diinput manual oleh admin/owner, otomatis memotong upah di akhir periode, dan muncul di laporan + Slip PDF.

### 1. Database (migration baru)

Tabel baru `public.employee_consumption`:
- `employee_id` (ref employees)
- `amount` (nominal)
- `note` (contoh: "Nasi padang", "Kopi + gorengan")
- `consumption_date` (tanggal jajan)
- `created_by` (admin/owner yang input)
- `deducted` boolean + `payroll_id` (nullable, terisi saat sudah dipotong di payroll)
- created_at / updated_at

RLS:
- Hanya admin/owner (`is_admin_or_owner`) yang bisa SELECT/INSERT/UPDATE/DELETE
- Karyawan **tidak** bisa lihat (permintaan user: hanya diakses admin & owner)
- GRANT untuk `authenticated` + `service_role`

### 2. Halaman baru `/consumption` (admin & owner only)

Mirip cashbon tapi lebih ringkas:
- Form input: pilih karyawan, tanggal, nominal, catatan
- List: filter per karyawan / rentang tanggal, total belum-dipotong per karyawan
- Aksi: edit, hapus (selama belum masuk payroll)
- Badge indikator: "Belum dipotong" (amber) / "Sudah dipotong" (hijau, kunci)

Menu di sidebar: "Konsumsi Karyawan" (icon Utensils), hanya tampil untuk staff.

### 3. Integrasi Payroll (`payroll.tsx`)

Saat Generate/Refresh payroll:
- Hitung total konsumsi karyawan periode itu yang `deducted=false`
- Tambahkan ke `deductions` bersama cashbon
- `total = base - (cashbon + konsumsi)`
- Simpan breakdown (bisa pakai kolom baru `payrolls.consumption_deduction` numeric default 0, plus tetap simpan `deductions` sebagai total)

Saat status payroll berubah ke `paid`:
- Tandai semua konsumsi periode itu sebagai `deducted=true` dan link `payroll_id`
- Trigger DB atau di client saat mutation `paid`

### 4. Slip PDF (`src/lib/payroll-pdf.ts`)

Tambah section baru "Rincian Konsumsi (Pengurang)" setelah Reparasi:
- Tabel: Tanggal, Catatan, Nominal
- Subtotal konsumsi
- Di Ringkasan Gaji: baris "Potongan Konsumsi" terpisah dari "Potongan Cashbon"

Update `SlipData` interface + pemanggilnya (di payroll.tsx / me.earnings.tsx) untuk pass data konsumsi.

### 5. Laporan (`reports.tsx`)

Tambah ringkasan total konsumsi per karyawan / periode (angka + list ringkas).

### Files yang akan disentuh

- **baru**: `supabase/migrations/<ts>_employee_consumption.sql`
- **baru**: `src/routes/_authenticated/consumption.tsx`
- **edit**: `src/integrations/supabase/types.ts` (auto setelah migration)
- **edit**: `src/routes/_authenticated/payroll.tsx` (include konsumsi di generate + mark deducted saat paid)
- **edit**: `src/lib/payroll-pdf.ts` (section + summary baru)
- **edit**: `src/routes/_authenticated/me.earnings.tsx` (jika memanggil generateSlipPdf, kirim data konsumsi milik user — meski user tak bisa lihat halaman input, dia melihat potongannya di slip)
- **edit**: `src/components/AppSidebar.tsx` (menu baru staff only)
- **edit**: `src/routes/_authenticated/reports.tsx` (ringkasan konsumsi)

### Pertanyaan cepat sebelum lanjut

1. Nama menu/halaman: **"Konsumsi Karyawan"** OK, atau lebih suka "Jajan Karyawan" / "Kas Konsumsi"?
2. Apakah karyawan boleh **melihat** riwayat konsumsi miliknya sendiri (read-only) di slip/halaman earnings, atau benar-benar tersembunyi kecuali muncul sebagai potongan di slip PDF akhir periode?
