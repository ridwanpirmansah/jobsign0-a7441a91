# Perbaikan "Missing SUPABASE_URL" saat Restore di Vercel

## Apa yang terjadi

Fitur Backup & Restore berjalan di sisi server. Nilai di berkas `.env.production`
hanya dipakai saat build untuk bagian browser (variabel `VITE_*`), sedangkan
bagian server di Vercel membaca variabel dari dashboard pada saat aplikasi
berjalan. Karena `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, dan
`SUPABASE_SERVICE_ROLE_KEY` belum diisi di dashboard Vercel, server menolak
dengan pesan "Missing Supabase environment variable(s)".

## Langkah yang Anda lakukan di Vercel (2 menit)

1. Buka project di Vercel → **Settings → Environment Variables**.
2. Isi tiga variabel ini (scope **Production** dan **Preview**):

   | Nama | Isi |
   | --- | --- |
   | `SUPABASE_URL` | `https://nphecqbddkawstxehbyv.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_GNr730MbUGaSX0wXEU3e6Q_7e1k-tPl` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key dari dashboard Supabase Anda |

3. Klik **Redeploy** (Deployments → titik tiga → Redeploy).
4. Coba lagi Restore di halaman `/owner/backup`.

## Yang saya kerjakan di repo

Menambahkan penjelasan di `DEPLOY.md` bahwa ketiga variabel di atas WAJIB diisi
di dashboard Vercel — isi berkas `.env.production` untuk nama yang sama tidak
terbaca oleh bagian server. Tidak ada perubahan kode aplikasi.
