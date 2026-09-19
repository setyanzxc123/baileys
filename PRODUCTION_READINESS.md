# Production Readiness Review

Tanggal review: 2026-09-01
Status resolusi: 2026-09-19 (lihat bagian "Status Resolusi" di bagian bawah dokumen)
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
| F-08 | P1 | Smoke test menembus jalur kirim real saat gateway online; kirim ke nomor tak terdaftar tidak dibatalkan | test/smoke.test.js, src/services/baileysService.js |

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

### F-08 (P1, teratasi 2026-09-02) Smoke test menembus jalur kirim real dan nomor tak terdaftar tidak dibatalkan

Insiden 2026-09-01: menjalankan npm test saat gateway online memicu 2 request kirim nyata ber-template OTP ke nomor acak (prefix 08123 + 6 digit acak). Akar masalahnya dua lapis:

1. Test cooldown dan test payload-invalid menjalankan request /send-otp valid ke samplePhone acak tanpa memperhatikan status koneksi. Saat gateway online, request pertama tiap test adalah percobaan kirim sungguhan ke nomor yang tidak pernah berinteraksi dengan akun.
2. prepareRecipient tetap melanjutkan pengiriman meski query onWhatsApp melaporkan nomor tidak terdaftar (exists false), sehingga stanza pesan tetap ditulis ke nomor yang kemungkinan tidak ada.

Akibatnya akun gateway terkena restriction (disconnect 403 Connection Failure) sekitar satu jam setelah test. Pengiriman template OTP ke nomor asing dan ke nomor tidak terdaftar adalah sinyal spam kuat bagi anti-abuse WhatsApp.

Perbaikan yang terpasang:
- Kedua test kini di-skip saat gateway online, mengikuti pola test fast-fail offline yang sudah ada.
- prepareRecipient membatalkan pengiriman dengan error WA_NUMBER_NOT_REGISTERED (HTTP 422) saat onWhatsApp melaporkan nomor tidak terdaftar; query gagal karena gangguan jaringan tetap fallback agar kirim tidak terblokir saat query outage.
- messageController memetakan error ber-statusCode 422 dari service.
- Test baru menambahkan verifikasi nomor tidak terdaftar saat gateway online.

Sisa risiko: false negative onWhatsApp dapat menghasilkan 422 palsu untuk nomor yang sebenarnya terdaftar; risiko ini diterima demi proteksi akun. F-01 (kuota terbakar percobaan gagal) masih terbuka dan berkaitan erat dengan proteksi akun.

## Risiko Permanen di Luar Kode

Baileys adalah library unofficial. Semua guard mengurangi tetapi tidak menghilangkan risiko pemblokiran nomor oleh WhatsApp. Langkah mitigasi operasional:
1. Gunakan nomor khusus gateway, bukan nomor pribadi.
2. Jalankan masa warm-up nomor baru sebelum volume naik.
3. Jangan kirim bulk ke kontak yang belum pernah berinteraksi.
4. Pantau circuit_breaker.hits_in_window di GET /status sebagai indikator dini.

Kuota default 30 per jam dan 200 per hari sengaja konservatif untuk warm-up. Setelah nomor stabil beberapa minggu, naikkan SENDER_MAX_PER_HOUR dan SENDER_MAX_PER_DAY sesuai volume real.

## Urutan Eksekusi

1. P1 F-08: teratasi 2026-09-02 (guard test, abort nomor tak terdaftar, test baru). Sebelum live traffic, restart proses gateway agar perbaikan aktif.
2. P1 F-01: reposisi konsumsi kuota pengirim, tambah unit test.
3. P1 F-02: keputusan infrastruktur (reverse proxy TLS atau bind localhost), terapkan, verifikasi dari mesin konsumen.
4. P2 F-04: cache onWhatsApp.
5. P2 F-03: evict job selesai, dokumentasi batasan bulk.
6. P3 F-05, F-06, F-07: kebersihan kode.

## Status Resolusi (2026-09-19)

Scope gateway dipangkas menjadi send-only OTP (konsumen API berjalan di mesin yang sama), dan seluruh temuan dituntaskan melalui fitur gw-011 sampai gw-018:

| ID | Status | Penyelesaian |
|----|--------|--------------|
| F-01 | Selesai (gw-014) | Kuota pengirim kini dikonsumsi tepat sebelum stanza ditulis (`consumeSendQuota`), sehingga percobaan saat offline, nomor tidak valid/tak terdaftar, dan breaker terbuka tidak membakar kuota. Cooldown dan limit per jam OTP di-refund saat kirim gagal; 504 sengaja tidak di-refund untuk mencegah OTP dobel. Dibuktikan lewat 5 unit test mock. |
| F-02 | Selesai (gw-015) | Bind default `127.0.0.1` (override via `HOST`) karena konsumen di mesin yang sama; CORS dihapus (gw-012). `GET /health` hanya mengekspos `whatsapp.connected` untuk monitor PM2; `GET /` tidak lagi menyertakan status klien. Nomor pengirim, kuota, dan breaker hanya terlihat via `GET /status` terproteksi. |
| F-03 | Moot (gw-012) | Antrean bulk dihapus bersama endpoint bulk, sehingga tidak ada lagi job in-memory yang hilang saat restart. |
| F-04 | Selesai (gw-017) | Resolusi onWhatsApp di-cache per nomor (positif 3 jam, negatif 5 menit), menghilangkan query berulang dan memangkas latensi kirim. |
| F-05 | Selesai (gw-018) | `uncaughtException` kini memanggil `process.exit(1)` agar PM2 me-restart dari kondisi bersih. |
| F-06 | Moot (gw-012) | `BaileysService.sendBulk` dan seluruh jalur bulk dihapus. |
| F-07 | Selesai (gw-018) | Seluruh logging dikonsolidasi ke pino; logger internal Baileys dipisah via `BAILEYS_LOG_LEVEL` (default silent), log aplikasi default info. |
| F-08 | Diperkuat (gw-013) | Test suite utama (`npm test`) kini berjalan penuh dengan mock sock tanpa koneksi WhatsApp; test smoke berisiko kirim nyata dihapus sehingga insiden 2026-09-01 tidak dapat terulang. |

Tambahan reliabilitas di luar daftar temuan: idempotency `Idempotency-Key` pada `/send-otp` dan `/send-message` (gw-016) serta `message_id` pada respons error 502/503/504, sehingga retry konsumen tidak menghasilkan OTP ganda.
