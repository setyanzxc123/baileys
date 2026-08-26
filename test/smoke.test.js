import assert from 'assert';

console.log('🧪 Memulai Automated Smoke Test Suite untuk DPRD WhatsApp Gateway (Baileys v7)...');

// Helper sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  const BASE_URL = 'http://localhost:3001';
  const API_KEY = 'dprd_secret_wa_gateway_key_2026';

  console.log('\n--- 1. Testing Root Discovery Endpoint (GET /) ---');
  try {
    const res = await fetch(`${BASE_URL}/`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.engine, 'Baileys v7');
    assert.strictEqual(data.status, 'running');
    console.log('✅ GET / responded with 200 OK and valid discovery data.');
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
    const resBadKey = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong_key' },
      body: JSON.stringify({ phone: '08123456789', otp: '123456' }),
    });
    assert.strictEqual(resBadKey.status, 401);
    console.log('✅ POST /send-otp with invalid API key rejected with 401 Unauthorized.');
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
    console.log('✅ POST /send-otp without OTP parameter returned 422 Unprocessable Content.');

    // Missing Phone
    const resMissingPhone = await fetch(`${BASE_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ message: 'Halo' }),
    });
    assert.strictEqual(resMissingPhone.status, 422);
    console.log('✅ POST /send-message without Phone parameter returned 422 Unprocessable Content.');
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
    // Saat socket belum di-scan QR, harus return 503 dengan kode WA_GATEWAY_OFFLINE
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
