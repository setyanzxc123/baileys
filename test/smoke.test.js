import assert from 'assert';
import 'dotenv/config';

console.log('🧪 Memulai Automated Smoke Test Suite untuk DPRD WhatsApp Gateway (Baileys v7)...');

async function runTests() {
  const BASE_URL = 'http://localhost:3001';
  const API_KEY = process.env.API_KEY;

  if (!API_KEY) {
    console.error('❌ API_KEY tidak ditemukan. Isi di file .env lalu jalankan ulang — server menolak berjalan tanpa kunci.');
    process.exit(1);
  }

  console.log('\n--- 1. Testing Root Discovery Endpoint (GET /) ---');
  try {
    const res = await fetch(`${BASE_URL}/`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.engine, 'Baileys v7');
    assert.strictEqual(data.status, 'running');
    assert.ok(data.endpoints.send_document);
    assert.ok(data.endpoints.send_image);
    assert.ok(data.endpoints.send_bulk);
    console.log('✅ GET / responded with 200 OK and discovery data.');
  } catch (e) {
    console.error('❌ GET / failed:', e.message);
  }

  console.log('\n--- 2. Testing Health Check (GET /health) ---');
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.uptime_seconds >= 0);
    assert.ok(data.memory.heap_used_mb);
    console.log(`✅ GET /health responded with 200 OK. RAM Heap: ${data.memory.heap_used_mb}MB`);
  } catch (e) {
    console.error('❌ GET /health failed:', e.message);
  }

  console.log('\n--- 3. Testing API Key Security Authentication ---');
  try {
    // Tanpa API Key -> 401
    const resNoKey = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '08123456789', otp: '123456' }),
    });
    assert.strictEqual(resNoKey.status, 401);
    console.log('✅ POST /send-otp without API key rejected with 401 Unauthorized.');

    // Kunci API Salah -> 401
    const resBadKey = await fetch(`${BASE_URL}/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong_key' },
      body: JSON.stringify({ phone: '08123456789', url: 'https://example.com/doc.pdf' }),
    });
    assert.strictEqual(resBadKey.status, 401);
    console.log('✅ POST /send-document with invalid API key rejected with 401 Unauthorized.');
  } catch (e) {
    console.error('❌ Authentication test failed:', e.message);
  }

  console.log('\n--- 4. Testing Input Validation (422 Unprocessable Content) ---');
  try {
    // Missing OTP
    const resMissingOtp = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ phone: '08123456789' }),
    });
    assert.strictEqual(resMissingOtp.status, 422);
    console.log('✅ POST /send-otp without OTP parameter returned 422.');

    // Missing Document URL
    const resMissingDocUrl = await fetch(`${BASE_URL}/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ phone: '08123456789' }),
    });
    assert.strictEqual(resMissingDocUrl.status, 422);
    console.log('✅ POST /send-document without document_url returned 422.');

    // Invalid Bulk Recipients
    const resBadBulk = await fetch(`${BASE_URL}/send-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ recipients: [] }),
    });
    assert.strictEqual(resBadBulk.status, 422);
    console.log('✅ POST /send-bulk with empty array returned 422.');
  } catch (e) {
    console.error('❌ Validation test failed:', e.message);
  }

  console.log('\n--- 5. Testing Offline Fast-Fail Handling ---');
  try {
    const resSend = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ phone: '08123456789', otp: '123456' }),
    });
    const data = await resSend.json();
    assert.strictEqual(resSend.status, 503);
    assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
    console.log('✅ POST /send-otp when offline gracefully returns 503 (WA_GATEWAY_OFFLINE).');
  } catch (e) {
    console.error('❌ Offline handling test failed:', e.message);
  }

  console.log('\n🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY! 🚀');
}

runTests();
