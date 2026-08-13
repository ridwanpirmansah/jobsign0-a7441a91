# Perbaikan Project "Nyangkut" di Orderan

## Masalah (sudah diverifikasi di data)

Order **522** hanya punya **1 item** di form input order (project P-0064), tetapi di database ada **3 project** yang masih menunjuk ke order 522:

- P-0064 — masih dipakai item order (benar)
- P-0049 — tidak punya item order lagi (nyangkut)
- P-0058 — tidak punya item order lagi (nyangkut)

Penyebabnya: saat sebuah item dihapus dari orderan, project-nya tidak pernah dilepas dari order. Kolom penghubung di project tetap terisi order lama, sehingga halaman Status Orderan tetap membaca 3 project.

## Yang akan diperbaiki

1. **Lepas otomatis saat item dihapus**
   Ketika sebuah item dihapus dari orderan (atau item dipindah ke orderan lain), project yang terkait langsung dilepas dari orderan itu dan kembali menjadi **Ready Stock** (tanpa orderan), bukan dihapus. Semua riwayat garapan/klaim project tetap utuh.

2. **Project yang sudah terlanjur nyangkut dibersihkan**
   Sekali jalan: semua project yang menunjuk ke sebuah orderan padahal sudah tidak punya item di orderan tersebut akan dilepas menjadi Ready Stock. Ini otomatis merapikan order 522 (P-0049 dan P-0058 lepas, tinggal P-0064).

3. **Status Orderan & Input Garapan ikut rapi**
   Karena keduanya membaca keterkaitan project–order, setelah perbaikan order 522 hanya menampilkan 1 project, dan project lepasan muncul di daftar Ready Stock.

## Catatan teknis

- Tambah trigger `AFTER DELETE ON public.order_items`: jika `OLD.project_id` tidak lagi direferensikan oleh item mana pun, set `projects.parent_order_id = NULL` dan status project dikembalikan ke `active` (ready stock tanpa order); jika order tersebut punya `orders.project_id` yang sama, kosongkan juga.
- Tambah trigger/`AFTER UPDATE OF project_id` pada `order_items` untuk kasus item ditukar produknya, agar project lama juga dilepas.
- Migration cleanup satu kali:
  `UPDATE public.projects p SET parent_order_id = NULL WHERE parent_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id) AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.project_id = p.id AND o.id = p.parent_order_id);`
  (varian aman: tetap pertahankan project header order lama yang memang masih dirujuk `orders.project_id`).
- Tidak ada perubahan tampilan; hanya data + trigger. Halaman `/status`, `/me/jobs`, dan tab Ready Stock otomatis ikut benar.
