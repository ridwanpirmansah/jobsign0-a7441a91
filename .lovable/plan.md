## Masalah

Data order Anda **tidak hilang** — 52 order masih utuh di database. Halaman Orders tampak kosong karena request ke server gagal dengan error:

> Could not embed because more than one relationship was found for 'orders' and 'order_items'

Penyebab: tabel `order_items` punya dua foreign key ke `orders`:
1. `order_id` → order induk
2. `source_ready_stock_order_id` → referensi ready-stock

PostgREST tidak tahu embed mana yang dimaksud saat kita menulis `order_items(...)`, jadi seluruh query gagal dan list kembali kosong.

## Perbaikan

Edit satu tempat di `src/lib/orders.functions.ts` pada `listOrders`: ubah embed dari

```
order_items(...)
```

menjadi eksplisit lewat FK order induk:

```
order_items!order_items_order_id_fkey(...)
```

Setelah itu list order langsung muncul kembali beserta ringkasan itemnya. Tidak ada perubahan skema, tidak ada migrasi.

## File yang disentuh

- `src/lib/orders.functions.ts` — 1 baris pada `listOrders`.
