import assert from 'node:assert';
import {
  DEFAULT_OTP_TEMPLATES,
  generateRefId,
  parseSpintax,
  buildOtpMessage,
} from '../src/utils/otpTemplateHelper.js';

console.log('Running OTP Template & Anti-Spam Unit Tests...');

// 1. generateRefId
const id1 = generateRefId(5);
const id2 = generateRefId(5);
assert.strictEqual(id1.length, 5);
assert.strictEqual(id2.length, 5);
assert.notStrictEqual(id1, id2);
console.log('PASS: generateRefId generates unique random strings of specified length');

// 2. parseSpintax
const spintaxSample = '{Halo|Hai|Selamat} {pagi|siang}, kode Anda adalah 123';
const parsed1 = parseSpintax(spintaxSample);
assert.match(parsed1, /^(Halo|Hai|Selamat) (pagi|siang), kode Anda adalah 123$/);

// Nested spintax check
const nestedSpintax = '{A|{B|C}}';
const parsedNested = parseSpintax(nestedSpintax);
assert.ok(['A', 'B', 'C'].includes(parsedNested));
console.log('PASS: parseSpintax handles single and nested spintax correctly');

// 3. buildOtpMessage default rotation
const seenTemplates = new Set();
for (let i = 0; i < 40; i++) {
  const res = buildOtpMessage({ otp: '123456', appName: 'TestApp', expiryMinutes: 10 });
  assert.ok(res.text.includes('123456'));
  assert.ok(res.text.includes('TestApp'));
  assert.ok(res.text.includes('10 menit'));
  assert.ok(res.text.includes('Ref: #'));
  assert.strictEqual(typeof res.refId, 'string');
  assert.ok(res.templateIndex >= 0 && res.templateIndex < DEFAULT_OTP_TEMPLATES.length);
  seenTemplates.add(res.templateIndex);
}
assert.strictEqual(seenTemplates.size, DEFAULT_OTP_TEMPLATES.length);
console.log(`PASS: buildOtpMessage rotates across all ${DEFAULT_OTP_TEMPLATES.length} templates`);

// 4. buildOtpMessage deterministic templateIndex
for (let idx = 0; idx < DEFAULT_OTP_TEMPLATES.length; idx++) {
  const res = buildOtpMessage({ otp: '778899', appName: 'MyPortal', templateIndex: idx, includeRef: false });
  assert.strictEqual(res.templateIndex, idx);
  assert.strictEqual(res.refId, null);
  assert.ok(!res.text.includes('Ref: #'));
  assert.ok(res.text.includes('778899'));
}
console.log('PASS: buildOtpMessage honors explicit templateIndex and includeRef=false');

// 5. buildOtpMessage custom template with spintax and placeholders
const customRes = buildOtpMessage({
  otp: '999111',
  appName: 'CustomApp',
  expiryMinutes: 3,
  template: '{Yth|Halo} Pelanggan, OTP {{app_name}} Anda: *{{otp}}*. Exp: {{expiry_minutes}}m.',
  includeRef: true,
});
assert.match(customRes.text, /^(Yth|Halo) Pelanggan, OTP CustomApp Anda: \*999111\*\. Exp: 3m\.\n\nRef: #[2-9A-Z]{5}$/);
assert.strictEqual(customRes.templateIndex, null);
assert.strictEqual(typeof customRes.refId, 'string');
console.log('PASS: buildOtpMessage processes custom template with spintax and placeholders');

console.log('All OTP Template unit tests PASSED successfully.');
