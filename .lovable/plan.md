## Rencana: Sembunyikan Badge Lovable + Tambah Tombol Install PWA

### Tujuan
1. Menyembunyikan badge "Edit with Lovable" dari publikasi.
2. Menambahkan tombol floating "Install Web App" agar karyawan bisa menginstall PWA dengan mudah (khususnya Android/Chrome).

### Detail Implementasi

#### 1. Badge Lovable
- Gunakan `publish_settings--set_badge_visibility` dengan `hide_badge: true`.
- Ini menghilangkan badge di pojok kanan bawah saat app dipublish.

#### 2. Floating Tombol Install PWA
- **Hook baru** `src/hooks/usePwaInstall.ts`: menangkap event `beforeinstallprompt` dari browser, menyimpannya, dan menyediakan fungsi `promptInstall()` serta state `canInstall`.
- **Komponen baru** `src/components/PwaInstallButton.tsx`: tombol floating fixed di pojok kanan bawah (bottom-4 right-4) dengan style pill/teal yang soft. Muncul hanya ketika `canInstall === true`. Saat diklik, memanggil `promptInstall()` dan menyembunyikan tombol setelah user merespons.
- **Integrasi**: pasang komponen di `src/routes/__root.tsx` (sebelum/di dalam `<Outlet />` atau setelahnya) agar tombol muncul di semua halaman.

#### 3. Fallback iOS
- Karena iOS tidak support `beforeinstallprompt`, tombol tidak akan muncul di Safari iOS — user tetap install via Share → Add to Home Screen (sudah didukung manifest & apple-touch-icon yang sudah ada).

### File yang akan diubah/dibuat
- `src/hooks/usePwaInstall.ts` (baru)
- `src/components/PwaInstallButton.tsx` (baru)
- `src/routes/__root.tsx` (edit: tambah komponen floating)

### Catatan
- Tidak menambahkan service worker / offline support (manifest-only PWA sudah cukup untuk install).
- Badge hanya disembunyikan di published deployment, tidak di preview editor.