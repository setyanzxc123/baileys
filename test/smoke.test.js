/**
 * Smoke test INTEGRASI untuk DPRD WhatsApp Gateway (Baileys v7).
 *
 * Test ini memanggil HTTP server yang sedang berjalan — bukan unit test:
 *   1. Pastikan .env terisi (API_KEY wajib).
 *   2. Jalankan server: npm start
 *   3. Jalankan test:  npm test
 *
 * Exit code 1 bila ada assertion gagal atau server tidak dapat dihubungi,
 * sehingga aman dipakai sebagai gate di CI.
 *
 * Catatan: seksi OTP memicu percobaan kirim nyata ke nomor sampel. Saat
 * gateway sedang online, percobaan itu benar-benar menghubungi server
 * WhatsApp — gunakan nomor sampel seperti di bawah, jangan nomor produksi.
 */
import assert from 'node:assert';
import 'dotenv/config';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const jsonPost = (path, body, headers = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// Nomor sampel acak per-run agar bucket cooldown OTP dari run sebelumnya
// tidak membuat run berikutnya false-fail dengan 429 di permintaan pertama.
const samplePhone = () => `08123${Math.floor(100000 + Math.random() * 900000)}`;

// ============================================================
// Test Cases
// ============================================================

test('GET / — service discovery mengembalikan katalog endpoint', async () => {
  const res = await fetch(`${BASE_URL}/`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.engine, 'Baileys v7');
  assert.strictEqual(data.status, 'running');
  for (const key of ['send_otp', 'send_document', 'send_image', 'send_bulk']) {
    assert.ok(data.endpoints?.[key], `endpoint '${key}' hilang dari discovery`);
  }
});

test('GET /health — health check mengembalikan status ok + metrik memori', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.uptime_seconds >= 0);
  assert.ok(Number(data.memory?.heap_used_mb) >= 0);
});

test('POST /send-otp tanpa API key — ditolak 401', async () => {
  const res = await jsonPost('/send-otp', { phone: '08123456789', otp: '123456' });
  assert.strictEqual(res.status, 401);
});

test('POST /send-document dengan API key salah — ditolak 401', async () => {
  const res = await jsonPost(
    '/send-document',
    { phone: '08123456789', url: 'https://example.com/doc.pdf' },
    { 'x-api-key': 'wrong_key' }
  );
  assert.strictEqual(res.status, 401);
});

test('GET /status dan /qr/raw tanpa API key — ditolak 401 (headless protected)', async () => {
  assert.strictEqual((await fetch(`${BASE_URL}/status`)).status, 401);
  assert.strictEqual((await fetch(`${BASE_URL}/qr/raw`)).status, 401);
});

test('GET /qr (halaman HTML) — sudah dihapus, 404', async () => {
  assert.strictEqual((await fetch(`${BASE_URL}/qr`)).status, 404);
});

test('POST /send-message dengan Content-Type text/plain — 422 JSON, bukan 500 HTML', async () => {
  const res = await fetch(`${BASE_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'x-api-key': API_KEY },
    body: 'hello',
  });
  // Di Express 5 req.body undefined saat content-type tidak dikenal parser;
  // handler harus guard dengan `req.body || {}` sehingga jawabannya 422 validasi,
  // bukan TypeError 500 dengan stack trace HTML.
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.status, 'error');
});

test('POST /send-message dengan body JSON rusak — 400 JSON (bukan HTML stack trace)', async () => {
  const res = await fetch(`${BASE_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: '{"phone": broken',
  });
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.status, 'error');
});

test('GET /nonexistent — 404 JSON konsisten, bukan HTML default Express', async () => {
  const res = await fetch(`${BASE_URL}/nonexistent`);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const data = await res.json();
  assert.strictEqual(res.status, 404);
  assert.strictEqual(data.code, 'NOT_FOUND');
});

test('POST /send-otp tanpa parameter otp — 422', async () => {
  const res = await jsonPost('/send-otp', { phone: '08123456789' }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-document tanpa document_url — 422', async () => {
  const res = await jsonPost('/send-document', { phone: '08123456789' }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-bulk dengan array kosong — 422', async () => {
  const res = await jsonPost('/send-bulk', { recipients: [] }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-otp saat gateway offline — fast-fail 503 WA_GATEWAY_OFFLINE', async () => {
  const statusRes = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const status = await statusRes.json();

  // Saat gateway online, request ini akan mengirim OTP sungguhan — dilewati.
  if (status.data?.connected) {
    return {
      skipped: true,
      reason: 'gateway sedang online — fast-fail offline tidak diuji agar tidak mengirim OTP nyata',
    };
  }

  const res = await jsonPost('/send-otp', { phone: samplePhone(), otp: '123456' }, { 'x-api-key': API_KEY });
  const data = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
});

test('POST /send-otp cooldown — OTP kedua ke nomor sama ditolak 429 OTP_COOLDOWN', async () => {
  const body = { phone: samplePhone(), otp: '555111' };
  const headers = { 'x-api-key': API_KEY };

  const resFirst = await jsonPost('/send-otp', body, headers);
  // 200 = online & terkirim, 500 = online tapi nomor sampel tidak terdaftar,
  // 503 = gateway offline. Ketiganya valid untuk permintaan pertama.
  assert.ok(
    [200, 500, 503].includes(resFirst.status),
    `permintaan pertama diharapkan 200/500/503, didapat ${resFirst.status}`
  );

  const resSecond = await jsonPost('/send-otp', body, headers);
  const dataSecond = await resSecond.json();
  assert.strictEqual(resSecond.status, 429);
  assert.strictEqual(dataSecond.code, 'OTP_COOLDOWN');
});

test('POST /restart — koneksi dimulai ulang tanpa hapus sesi', async () => {
  const res = await fetch(`${BASE_URL}/restart`, { method: 'POST', headers: { 'x-api-key': API_KEY } });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'success');
  assert.ok(
    ['connecting', 'qr_ready', 'connected'].includes(data.data?.current_status),
    `current_status tak terduga: ${data.data?.current_status}`
  );
});

// ============================================================
// Runner
// ============================================================

const run = async () => {
  console.log(`🧪 Smoke Test Integrasi — DPRD WhatsApp Gateway (Baileys v7) → ${BASE_URL}\n`);

  if (!API_KEY || API_KEY.trim() === '') {
    console.error('❌ API_KEY tidak ditemukan di .env. Server menolak berjalan tanpa kunci — isi dulu sebelum testing.');
    process.exit(1);
  }

  // Pastikan server hidup sebelum menyalahkan gateway dengan assertion gagal.
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`GET /health menjawab ${res.status}`);
  } catch (e) {
    console.error(`❌ Server tidak dapat dihubungi di ${BASE_URL} (${e.message}).`);
    console.error('   Ini test integrasi — jalankan `npm start` di terminal terpisah dulu, lalu ulangi `npm test`.');
    process.exit(1);
  }

  let failed = 0;
  let skipped = 0;

  for (const { name, fn } of tests) {
    try {
      const outcome = await fn();
      if (outcome?.skipped) {
        skipped++;
        console.log(`⏭️  SKIP: ${name} — ${outcome.reason}`);
      } else {
        console.log(`✅ ${name}`);
      }
    } catch (e) {
      failed++;
      console.error(`❌ ${name}\n   ↳ ${e.message}`);
    }
  }

  console.log(`\nHasil: ${tests.length - skipped - failed} lulus, ${failed} gagal, ${skipped} dilewati.`);

  if (failed > 0) {
    console.error('💥 SMOKE TEST GAGAL.');
    process.exit(1);
  }

  console.log('🎉 Semua smoke test yang relevan LULUS.');
};

run();
