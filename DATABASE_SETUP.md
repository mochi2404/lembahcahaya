# Setup Database dan Sinkronisasi

## Ringkas

Project ini sekarang bisa berjalan dalam 2 mode:

1. `Postgres mode`
   Dipakai kalau `DATABASE_URL` atau `POSTGRES_URL` tersedia.
   Ini mode yang direkomendasikan untuk Vercel dan production.

2. `JSON fallback mode`
   Dipakai kalau env database belum tersedia.
   Cocok untuk transisi atau lokal sederhana, tapi tidak stabil untuk production.

## 1. Buat database

Pilihan yang paling mudah:

- `Vercel Postgres`
- `Neon Postgres`
- `Supabase Postgres`

Kalau pakai Vercel:

1. Buka project di Vercel
2. Masuk ke `Storage`
3. Tambahkan `Postgres`
4. Hubungkan ke project

Setelah itu biasanya env seperti `POSTGRES_URL` akan otomatis tersedia.

## 2. Tambahkan environment variable

Minimal isi:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
ADMIN_SESSION_SECRET=ganti-dengan-random-secret-yang-panjang
```

Catatan:

- Kalau Vercel Postgres sudah memberi `POSTGRES_URL`, itu juga bisa dipakai.
- `ADMIN_SESSION_SECRET` wajib diisi agar login admin aman dan stabil.

## 3. Deploy ulang

Setelah env diisi:

1. Redeploy project di Vercel
2. Saat API pertama kali jalan, schema akan dibuat otomatis
3. Default config dan default menu juga akan otomatis di-seed ke database

## 4. Cek mode storage

Setelah deploy:

- buka endpoint `/api/bootstrap`
- cek header response `X-Storage-Mode`

Nilainya:

- `postgres` = sudah pakai database
- `json-fallback` = belum pakai database

## 5. Sinkronisasi data lama dari JSON ke database

Kalau sebelumnya kamu sudah punya data menu/order di mode JSON:

1. Jalankan project lama / mode JSON
2. Login admin
3. Buka menu backup
4. `Backup Data`
5. Simpan file JSON hasil export

Lalu setelah database aktif:

1. Login admin di project yang sudah pakai database
2. Buka menu restore
3. Pilih file backup tadi
4. Data config, menu, dan order akan masuk ke database

## 6. Test setelah migrasi

Checklist:

1. Login admin berhasil
2. Tambah menu baru berhasil
3. Edit/hapus menu berhasil
4. Customer melihat menu terbaru
5. Order baru masuk ke admin tanpa refresh manual
6. Produk tidak kembali ke versi lama setelah reload / redeploy
7. Test Telegram berhasil

## 7. Jalankan lokal dengan database

Di lokal:

1. buat file `.env` berdasarkan `.env.example`
2. isi `DATABASE_URL`
3. jalankan:

```bash
npm install
npm start
```

Server lokal sekarang memakai jalur backend yang sama dengan Vercel.
