## Penyebab

HPP di tabel selalu lebih besar dari Kalkulasi Live ketika order **tanpa Outdoor**.

Trigger database `calc_order_costs` punya aturan:
```
IF outdoor_cost IS NULL OR outdoor_cost = 0 THEN
  outdoor_cost := titik * 2000;
```
Artinya: walaupun frontend mengirim `outdoor_cost = 0` (karena toggle "Outdoor" OFF), database tetap memaksa mengisi `titik × 2000`. Sementara Kalkulasi Live di form menghormati toggle dan memakai 0. Itu sebabnya nilai HPP di tabel jauh lebih besar — selisihnya kira-kira `titik × 2000 × 1.01`.

(Aturan serupa juga ada untuk `kabel_meter`, tapi di sana frontend & DB sama-sama auto-fill saat 0, jadi tidak menimbulkan beda.)

## Rencana Perbaikan

1. **Migrasi DB** — ubah `calc_order_costs`:
   - `outdoor_cost`: hanya auto-isi `titik × 2000` saat `IS NULL` (bukan saat `= 0`). Sehingga nilai 0 yang dikirim user benar-benar dihormati.
   - `kabel_meter`: ubah jadi `IS NULL` only juga, biar konsisten.
2. **Frontend `orders.tsx`** — saat toggle Outdoor OFF, kirim `outdoor_cost: null` (bukan 0) agar maknanya jelas "tidak ada outdoor", bukan "auto-hitung".
3. **Verifikasi** — tambah order baru tanpa outdoor → HPP tabel == HPP kalkulasi live. Edit order lama existing yang nilainya sudah ter-hitung tidak akan berubah otomatis (perlu re-save bila ingin sinkron).

Tidak ada perubahan pada logika kalkulasi lain (LED, akrilik, biaya lainnya 1%, dsb).