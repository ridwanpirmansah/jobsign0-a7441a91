
## Kenapa scan di iPhone masih gagal (analisis jujur)

Preview kameramu muncul, tapi barcode tidak pernah decode. Itu berarti izin kamera OK, stream jalan — masalahnya ada di **pipeline decode ZXing di iOS PWA**. Dari kode `src/components/ResiScanner.tsx` sekarang, ada 3 penyebab yang cocok dengan gejala kamu:

1. **Reader-nya cuma 1D.** Sekarang saya pakai `BrowserMultiFormatOneDReader`. Kalau ada satu saja resi yang barcode-nya bukan 1D murni (misal QR / DataMatrix / PDF417 dari beberapa ekspedisi atau resi FE hasil generate kita sendiri yang di-render `JsBarcode` code128 tapi kadang terpotong), decoder ini diam saja. Di Android tertolong `BarcodeDetector` native — makanya kamu tidak sadar. iOS tidak punya `BarcodeDetector`, jadi 100% bergantung ZXing.
2. **iOS PWA `videoWidth` sering masih 0 saat `decodeFromVideoElement` dipanggil.** Kita cuma nunggu `loadedmetadata`, padahal di standalone PWA iOS frame pertama baru datang di event `playing`/`loadeddata`. ZXing lalu meng-capture canvas 0×0 → tidak pernah ada kandidat untuk didecode. Ini persis "preview jalan, barcode tak terdeteksi".
3. **`applyConstraints` zoom 1.15× dipanggil setelah reader start.** Di iOS ini kadang me-reset track sebentar; ZXing sudah mulai loop dengan referensi frame lama. Bukan penyebab utama, tapi memperparah.

Yang bikin ini terasa "sia-sia": saya beberapa kali menebak fix untuk iOS tanpa bisa mengetes langsung di iPhone dari sandbox (sandbox cuma punya Chromium headless). Plan ini fokus fix akar masalah di atas, bukan tebak-tebakan lagi.

## Yang akan diubah

**File: `src/components/ResiScanner.tsx`** (satu file, no DB, no perubahan Android path)

1. **Ganti reader jadi multi-format** — pakai `BrowserMultiFormatReader` dari `@zxing/browser` supaya QR / DataMatrix / PDF417 juga kebaca, dengan hints `POSSIBLE_FORMATS` = semua 1D yang sekarang + `QR_CODE`, `DATA_MATRIX`, `PDF_417`, `AZTEC`. Android tetap dapat manfaat, dan `BarcodeDetector` native Android juga ditambah format `qr_code`, `data_matrix`, `pdf417`, `aztec`.
2. **Tunggu frame benar-benar siap sebelum decode.** Setelah `video.play()`, tunggu event `playing` **dan** poll `videoWidth > 0` (timeout 3 dtk). Baru panggil `decodeFromVideoElement`. Kalau `videoWidth` masih 0 setelah timeout, lepas stream lalu retry sekali dengan constraint lebih rendah (`640×480`, tanpa zoom).
3. **Buang `applyConstraints` zoom di iOS.** Detect iOS → skip `tuneCamera` untuk zoom; tetap coba `focusMode: continuous` saja (aman di iOS). Di Android tetap seperti sekarang (zoom 1.15× + focus + exposure).
4. **Loop decode manual sebagai jaring pengaman iOS.** Selain `decodeFromVideoElement`, jalankan `setInterval` 120ms yang capture frame video ke `OffscreenCanvas`/`canvas` lalu panggil `reader.decodeFromCanvas`. Ini bypass ketergantungan ZXing pada `requestAnimationFrame` yang di iOS PWA standalone kadang di-throttle saat layar redup. Hanya aktif di iOS.
5. **Log diagnostik ringan di iOS** (`console.info` untuk `videoWidth`, `readyState`, `decode attempt count`) supaya kalau masih gagal, next turn saya bisa baca dari console logs kamu tanpa harus nebak lagi.

**Yang TIDAK berubah:**
- Android path (`BarcodeDetector` native + ZXing fallback + constraint 1920×1080 + zoom 1.15×) → tetap sama persis, cuma nambah format list.
- API `ResiScanner` (`onScan`, `active`, `cooldownMs`) → tidak berubah, semua halaman pemanggil (`me.ship`, `me.pickup`, `status`) tidak perlu diedit.
- `src/lib/scan-feedback.ts` dan file lain → tidak disentuh.

## Cara verifikasi

- Sandbox: build + jalankan test regresi Playwright di Chromium desktop untuk memastikan tidak ada regresi (kamera fake / stream dummy).
- iPhone: **kamu perlu tes langsung** dan kirim balik apa yang tampil di layar. Kalau masih gagal, saya minta buka `Settings → Safari → Advanced → Web Inspector` dan colok ke Mac (atau cukup screenshot pesan yang muncul di bawah kamera) — dengan `console.info` di poin 5, saya bisa lihat apakah `videoWidth` sudah > 0 dan berapa kali attempt decode terjadi. Baru dari situ saya bisa lanjut ke fix berikutnya kalau perlu, bukan nebak.

## Catatan jujur soal kredit

Kamu benar bahwa iterasi iPhone selama ini terlalu banyak nebak. Saya tidak bisa menjalankan Safari iOS asli di sandbox — itu keterbatasan nyata. Plan ini menyerang 3 penyebab teknis paling mungkin sekaligus (bukan satu-satu seperti sebelumnya), plus menambah log supaya iterasi berikutnya berdasar data, bukan tebakan.
