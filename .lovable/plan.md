
## 1. Cache & preload suara scan (hilangkan delay)

Masalah: `speakId()` di `src/lib/scan-feedback.ts` memanggil `SpeechSynthesisUtterance` baru setiap kali scan → di HP suara sering telat karena voice list & TTS engine baru "warm up" saat pertama dipanggil. AudioContext juga sering `suspended` sampai gesture pertama.

Perbaikan di `src/lib/scan-feedback.ts`:
- Cache daftar voices Indonesia sekali (listen `voiceschanged`), simpan referensi `SpeechSynthesisVoice` di module scope agar tidak dilookup ulang tiap scan.
- Cache instance `SpeechSynthesisUtterance` per frasa yang dipakai ("Check In Berhasil, Selamat Bekerja", "Check Out Berhasil, Selamat Istirahat", frasa error) — reuse instance yang sama tiap panggilan.
- Warm-up: saat halaman scan mount, panggil `primeSpeech()` yang sekarang juga:
  - resume `AudioContext`,
  - `speechSynthesis.speak` utterance kosong volume 0 (memicu engine load di iOS/Android),
  - decode & cache beep sukses/gagal jadi `AudioBuffer` sekali, lalu putar via `AudioBufferSourceNode` (lebih cepat & konsisten daripada bikin oscillator baru tiap kali).
- Tambah service worker ringan (via `vite-plugin-pwa` `generateSW` yang sudah dipakai project ini bila ada; kalau belum, gunakan manifest-only + runtime cache di memori saja) untuk cache aset statis. Cache suara **bukan** file mp3 (semua synthesized), jadi yang dibutuhkan cuma warm-up di atas — tidak perlu SW baru untuk itu.

Halaman yang perlu panggil `primeSpeech()` di mount (sudah sebagian): `me.scan.tsx`, `me.ship.tsx`, `me.pickup.tsx`, dan tombol Scan Resi di `status.tsx`. Pastikan dipanggil sekali di `useEffect` awal.

## 2. Perbaiki scanner iPhone (tanpa merusak Android)

File: `src/components/ResiScanner.tsx`. Gejala saat ini di iPhone: kamera hidup tapi tidak decode / preview lambat.

Rencana:
- Deteksi Safari iOS dan pakai constraint yang ramah iOS:
  - Hindari `width/height ideal 1920x1080` di iOS (Safari sering fallback ke stream kosong) — pakai 1280x720 di iOS, biarkan 1920x1080 di Android.
  - Set `facingMode: { exact: "environment" }` hanya bila tersedia; fallback ke `ideal` (iOS kadang throw `OverconstrainedError` dengan `exact`).
- Pastikan `video.play()` dipanggil di dalam gesture handler tombol "Mulai Scan" (sudah, tapi verifikasi urutan: getUserMedia → set srcObject → await loadedmetadata → play, semuanya di dalam handler klik, tanpa `await` panjang sebelum `play`).
- iOS Safari tidak punya `BarcodeDetector`, jadi ZXing harus jalan mulus. Turunkan `delayBetweenScanAttempts` iOS ke 50ms dan pastikan hint `TRY_HARDER` + format 1D lengkap (sudah).
- Tambah retry: jika `videoWidth === 0` setelah play, coba `track.applyConstraints` lagi & re-attach.
- Tetap gunakan `BarcodeDetector` native di Android (sudah), tanpa perubahan perilaku.

Verifikasi setelah build: buka `/me/ship` di iPhone Safari (via Playwright hanya cek tidak regresi di desktop; iPhone dites manual oleh user).

## 3. Rapikan menu sidebar Owner + sembunyikan Ready Stock

File: `src/components/AppSidebar.tsx`.

- Buat grup "Pengaturan" collapsible di dalam sidebar (pakai `Collapsible` dari shadcn + `SidebarGroup`) berisi:
  1. Master Harga (`/owner/prices`)
  2. Master Ekspedisi (`/owner/carriers`)
  3. Sync Project (`/owner/sync`)
  4. Kelola User (`/users`)
  5. Setelan Akses Fitur (`/owner/permissions`)
  6. Backup & Restore (`/owner/backup`)
- Sisa item Owner (QR Absensi, Riwayat Absensi, Payroll, Analitik & Performa, Catatan Pengeluaran, Laporan) tetap tampil langsung di grup "Owner".
- Auto-expand grup "Pengaturan" bila route aktif ada di dalamnya.
- Hapus item **Ready Stock** dari `adminItems` di sidebar. Halaman `/ready-stock` tetap ada dan hanya diakses via tab di halaman Order (sudah ada `WorkflowTabs`).

## Ringkasan file yang berubah
- `src/lib/scan-feedback.ts` — cache voice & utterance, AudioBuffer beep, warm-up lebih agresif.
- `src/components/ResiScanner.tsx` — constraint iOS-aware, fallback lebih rapi.
- `src/components/AppSidebar.tsx` — grup "Pengaturan" collapsible, hapus Ready Stock.
- (opsional) panggil `primeSpeech()` di halaman scan yang belum memanggilnya.

Tidak ada perubahan database.
