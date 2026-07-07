# Perbaikan Link "Detail →" Project

## Masalah
Klik "Detail →" tidak membuka halaman detail project. URL berubah tapi konten tetap menampilkan daftar project (atau kosong).

## Penyebab
Di TanStack Router, file `src/routes/_authenticated/projects.tsx` dan `src/routes/_authenticated/projects.$id.tsx` memiliki prefix nama yang sama. Router memperlakukan `projects.tsx` sebagai **layout parent** dari `projects.$id.tsx`. Karena `projects.tsx` merender daftar project langsung (tanpa `<Outlet />`), child route `/projects/$id` tidak pernah punya tempat untuk dirender.

## Solusi
Ubah `projects.tsx` menjadi route index sehingga tidak lagi menjadi layout parent:

1. **Rename file**: `src/routes/_authenticated/projects.tsx` → `src/routes/_authenticated/projects.index.tsx`
2. **Update `createFileRoute`** di file tersebut dari `/_authenticated/projects` menjadi `/_authenticated/projects/`
3. Biarkan `projects.$id.tsx` apa adanya — sekarang menjadi sibling, bukan child.

Setelah ini `/projects` tetap menampilkan list, dan `/projects/{id}` merender halaman detail secara benar.

## File yang diubah
- Rename + edit `src/routes/_authenticated/projects.tsx` → `projects.index.tsx` (ganti path pada `createFileRoute`)
- `src/routeTree.gen.ts` akan di-regenerate otomatis oleh plugin
