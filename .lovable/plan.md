# Perbaikan "Email not confirmed" di Supabase Sendiri

## Apa yang terjadi

Akun berhasil dibuat, tetapi login ditolak karena Supabase Anda masih mewajibkan
verifikasi email. Karena project Supabase itu milik Anda sendiri (bukan Lovable
Cloud), pengaturannya harus diubah di dashboard Supabase — tidak bisa saya ubah
dari sini.

## Langkah yang Anda lakukan (5 menit)

1. Buka dashboard Supabase project Anda → **Authentication → Sign In / Providers → Email**.
2. Matikan opsi **Confirm email**, lalu Save.
3. Akun yang sudah terlanjur dibuat masih berstatus belum terverifikasi.
   Jalankan sekali di SQL Editor untuk menandai semua akun sebagai terverifikasi:

   ```sql
   update auth.users
   set email_confirmed_at = now()
   where email_confirmed_at is null;
   ```

4. Coba login ulang di `https://newjobsign.vercel.app`.

Kalau ingin tetap memakai verifikasi email, biarkan **Confirm email** menyala,
tapi Anda harus mengatur pengirim email (SMTP) sendiri di
**Authentication → Emails → SMTP Settings**, karena email bawaan Supabase
dibatasi sangat ketat dan sering tidak sampai.

## Yang saya kerjakan di repo

Menambahkan bagian **"Login gagal: Email not confirmed"** di `DEPLOY.md` berisi
langkah di atas, supaya tercatat untuk deploy berikutnya. Tidak ada perubahan
pada kode aplikasi dan tidak ada dampak ke webapp yang berjalan di Lovable.
