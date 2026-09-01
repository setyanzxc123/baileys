# Production Readiness Review

Tanggal review: 2026-09-01
Scope: seluruh kode gateway (src/, test/, konfigurasi) dengan use case khusus pengiriman pesan keluar (notification dan OTP).
Metode: telaah kode lengkap, verifikasi live server, dan eksekusi test suite.

## Ringkasan

Proyek layak production untuk skala notification/OTP internal (puluhan sampai ratusan kirim per hari) dengan syarat dua temuan P1 ditangani terlebih dahulu. Kualitas kode, keamanan dasar, dan perlindungan anti-restriction berada di atas standar proyek gateway Baileys pada umumnya. Temuan P2 bersifat peningkatan yang dapat menyusul setelah live.

| ID | Prioritas | Temuan | Lokasi |
|----|-----------|--------|--------|
| F-01 | P1 | Kuota pengirim terbakar oleh percobaan gagal, bukan kirim sukses | src/services/baileysService.js:444 |
| F-02 | P1 | Eksposur jaringan: listen 0.0.0.0 tanpa TLS, CORS tidak dibatasi | src/server.js:41, src/config/app.js:17 |
| F-03 | P2 | Seluruh state di RAM: job bulk hilang saat restart, jobs Map tanpa evict | src/services/queueService.js:11 |
| F-04 | P2 | Tidak ada cache resolusi onWhatsApp, latensi 1-2 detik per kirim | src/services/baileysService.js:405 |
| F-05 | P3 | uncaughtException hanya di-log, proses tetap hidup dalam state tidak pasti | src/server.js:94 |
| F-06 | P3 | Dead code: BaileysService.sendBulk sudah digantikan queue service | src/services/baileysService.js:554 |
| F-07 | P3 | Logging campur console dan pino, tidak terstruktur | beberapa file |

## Bukti Verifikasi

- npm test: 27 lulus, 0 gagal, 3 dilewati. Tiga test dilewati karena gateway sedang online (fast-fail offline hanya berlaku saat gateway mati, perilaku ini benar).
- Status live: connected ke WhatsApp dengan nomor gateway aktif, circuit breaker tertutup, kuota tercatat.
- API_KEY pada .env kuat (67 karakter, bukan placeholder).
- .env dan sessions/ tidak masuk git (terverifikasi pada .gitignore dan git ls-files).

## Kekuatan

1. Arsitektur modular (config, middlewares, services, controllers, utils) dengan total sekitar 1.400 baris, mudah dirawat.
2. Keamanan dasar benar: perbandingan API key timing-safe, rate limit berlapis (per IP, cooldown OTP per nomor, limit pengirim global), single-instance lockfile mencegah conflict 440 akibat instance ganda.
3. Perlindungan anti-restriction lengkap: circuit breaker 463 bertingkat, kuota pengirim 30 per jam dan 200 per hari, pre-warm tctoken sebelum kirim 1:1. Semua terpantau di GET /status.
4. Resilience socket: reconnect backoff, penanganan 401/440/515/463 dengan jalur terpisah, outbox buffer saat reconnect singkat, graceful shutdown.
5. Deployment siap: ecosystem PM2 dengan autorestart dan memory cap, endpoint /health dan /status untuk monitoring.

## Detail Temuan

### F-01 (P1) Kuota pengirim terbakar oleh percobaan gagal

assertSendAllowed() dipanggil di awal sendMessage, sendDocument, dan sendImage, sebelum waitForConnection dan validasi pesan. Saat gateway offline dan aplikasi konsumen melakukan retry, kuota 30 per jam tetap terkonsumsi meski tidak ada stanza yang dikirim. Dampak untuk OTP: cukup 30 request gagal untuk memblokir seluruh pengiriman real selama satu jam penuh dengan HTTP 429.

Rekomendasi: pindahkan konsumsi kuota (tryConsume) ke tepat sebelum sock.sendMessage setelah koneksi terverifikasi, atau naikkan default kuota setelah masa warm-up nomor selesai.

Verifikasi yang disarankan: unit test yang membuktikan request saat offline tidak mengonsumsi kuota.

### F-02 (P1) Eksposur jaringan

Server listen pada 0.0.0.0 tanpa TLS dan .env memakai CORS_ALLOWED_ORIGINS=*. API key menjadi satu-satunya penghalang. Jika port terbuka ke publik, key berisiko disadap karena komunikasi tidak terenkripsi.

Rekomendasi (pilih salah satu):
- Tempatkan di belakang reverse proxy nginx dengan TLS, set TRUST_PROXY=true agar rate limit per IP akurat.
- Bind ke 127.0.0.1 bila konsumen berada di mesin yang sama.
- Batasi CORS_ALLOWED_ORIGINS ke origin konsumen bila konsumen berbasis browser.

### F-03 (P2) State in-memory hilang saat restart

queueService.jobs adalah Map di RAM tanpa evict job selesai (tumbuh perlahan pada uptime panjang). Job bulk yang berjalan saat PM2 restart hilang dan job_id milik konsumen menjadi 404. Sirkuit breaker dan kuota per jam juga reset saat restart, sehingga crash loop dapat dipakai untuk melewati batas pengirim.

Rekomendasi: evict job selesai setelah TTL tertentu; simpan job bulk aktif ke disk bila bulk menjadi alur kritis; opsi lain, terima kehilangan job bulk saat deploy dan dokumentasikan sebagai batasan.

### F-04 (P2) Tidak ada cache resolusi onWhatsApp

prepareRecipient menjalankan query onWhatsApp, presence composing 800 ms, dan cek tctoken untuk setiap kirim 1:1. Kontak yang sama di-query ulang setiap kali kirim. Selain menambah latensi, query berulang ke server WA dapat menarik sinyal restriction.

Rekomendasi: cache hasil onWhatsApp per nomor dengan TTL beberapa jam, invalidasi saat send gagal dengan error nomor tidak terdaftar.

### F-05 (P3) uncaughtException hanya di-log

Handler hanya mencatat error dan proses tetap hidup dalam state yang berpotensi tidak konsisten. Dengan PM2, keluar dari proses lebih aman karena autorestart akan memulihkan kondisi, dan sesi aman karena tersimpan di disk.

Rekomendasi: panggil process.exit(1) pada uncaughtException dan biarkan PM2 me-restart. Pertahankan unhandledRejection sebagai log saja.

### F-06 (P3) Dead code

BaileysService.sendBulk pada src/services/baileysService.js:554 tidak lagi dipanggil karena alur bulk sudah penuh ditangani queueService. Hapus untuk mengurangi permukaan kode.

### F-07 (P3) Logging tidak terstruktur

Sebagian modul memakai console.log/warn/error dan sebagian memakai pino. Tidak ada rotasi log terstruktur selain stdout PM2. Fungsional untuk skala saat ini.

Rekomendasi: konsolidasikan ke pino, tambahkan rotasi via pm2-logrotate bila butuh retensi.

## Risiko Permanen di Luar Kode

Baileys adalah library unofficial. Semua guard mengurangi tetapi tidak menghilangkan risiko pemblokiran nomor oleh WhatsApp. Langkah mitigasi operasional:
1. Gunakan nomor khusus gateway, bukan nomor pribadi.
2. Jalankan masa warm-up nomor baru sebelum volume naik.
3. Jangan kirim bulk ke kontak yang belum pernah berinteraksi.
4. Pantau circuit_breaker.hits_in_window di GET /status sebagai indikator dini.

Kuota default 30 per jam dan 200 per hari sengaja konservatif untuk warm-up. Setelah nomor stabil beberapa minggu, naikkan SENDER_MAX_PER_HOUR dan SENDER_MAX_PER_DAY sesuai volume real.

## Urutan Eksekusi

1. P1 F-01: reposisi konsumsi kuota pengirim, tambah unit test.
2. P1 F-02: keputusan infrastruktur (reverse proxy TLS atau bind localhost), terapkan, verifikasi dari mesin konsumen.
3. P2 F-04: cache onWhatsApp.
4. P2 F-03: evict job selesai, dokumentasi batasan bulk.
5. P3 F-05, F-06, F-07: kebersihan kode.
