# Perbaikan Redirect URI Shopee OAuth

## Masalah
Saat menghubungkan toko Shopee, muncul error dari Shopee:

> The domain of the redirect_uri when generating authorization & deauthorization link in sandbox environment should be consistent with this domain. Invalid test redirect url domain, please fill in an valid domain starting with http(s)://

Penyebabnya: kode saat ini membangun `redirect_uri` dari `window.location.origin` halaman yang sedang dibuka. Shopee Sandbox mengharuskan domain redirect URI sama persis dengan domain yang didaftarkan di Shopee Developer Console. Jika halaman dibuka dari preview URL (`*.lovable.app`) atau domain lain, domain tersebut belum terdaftar di Shopee sehingga ditolak.

## Tujuan
Buat redirect URI Shopee menjadi tetap dan bisa dikonfigurasi, sehingga owner dapat mendaftarkan domain publik (misal `https://job.lintangsemesta.com`) di Shopee Developer Console dan selalu menggunakannya.

## Perubahan yang akan dilakukan

### 1. Skema database
- Tambah kolom `redirect_url text` pada tabel `public.shopee_settings`.
- Berikan GRANT SELECT untuk kolom ini ke `authenticated` (selain `partner_id` yang sudah diberi GRANT).
- Kolom `partner_key` tetap tidak diberi GRANT ke authenticated demi keamanan.

### 2. Server function (`src/lib/shopee.server.ts`)
- Ubah `buildAuthUrl(origin)` menjadi `buildAuthUrl(origin, redirectUrl?)`.
- Jika `redirect_url` tersimpan dan valid (diawali `http://` atau `https://`), gunakan `${redirect_url}/api/public/shopee/callback`.
- Jika tidak ada, fallback ke `origin` lama agar tidak merusak pengaturan yang sudah berjalan.
- Tambahkan validasi URL sederhana agar Shopee tidak ditolak karena format.

### 3. Server function wrapper (`src/lib/shopee.functions.ts`)
- `getShopeeAuthUrl` tidak lagi mengirim `origin` dari browser, melainkan membaca `redirect_url` dari server.
- Hapus parameter `origin` dari input schema atau jadikan opsional.
- `getShopeeStatus` mengembalikan `redirect_url` agar UI bisa menampilkannya.
- `saveShopeeSettings` menerima dan menyimpan `redirect_url`.

### 4. UI halaman Shopee (`src/routes/_authenticated/owner.shopee.tsx`)
- Tambah input "Redirect URL" di bawah kredensial dengan placeholder `https://job.lintangsemesta.com`.
- Tampilkan callback URL final yang akan digunakan berdasarkan redirect URL yang tersimpan.
- Berikan petunjuk teks: daftarkan URL tersebut persis seperti yang tampil di Shopee Developer Console → App Settings → Redirect URL.
- Validasi input: wajib diawali `http://` atau `https://`, tidak boleh mengandung path selain yang akan ditambahkan otomatis.

### 5. Tipe Supabase (`src/integrations/supabase/types.ts`)
- Tambahkan field `redirect_url: string | null` pada bagian Row/Insert/Update tabel `shopee_settings`.

## Catatan penggunaan
Setelah perubahan ini, owner harus:
1. Buka halaman **Integrasi Shopee**.
2. Isi **Redirect URL** dengan domain publik yang sudah terhubung ke aplikasi, misalnya `https://job.lintangsemesta.com`.
3. Salin **Callback URL** yang muncul (contoh: `https://job.lintangsemesta.com/api/public/shopee/callback`).
4. Tempel callback URL tersebut ke kolom **Redirect URL** / **Test Redirect URL** di Shopee Developer Console.
5. Simpan pengaturan, lalu klik "Hubungkan Toko Shopee".

## Kriteria selesai
- [ ] Input Redirect URL muncul dan bisa disimpan.
- [ ] Callback URL yang ditampilkan mengikuti Redirect URL yang tersimpan.
- [ ] Tombol "Hubungkan Toko Shopee" mengarahkan ke Shopee dengan `redirect_uri` sesuai konfigurasi.
- [ ] Build dan typecheck berhasil.
