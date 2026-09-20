import crypto from 'node:crypto';

export const DEFAULT_OTP_TEMPLATES = [
  '*KODE VERIFIKASI LOGIN*\n\nKode OTP Anda untuk portal *{{app_name}}* adalah:\n\n*{{otp}}*\n\n_Kode ini berlaku selama {{expiry_minutes}} menit. Jangan berikan kode ini kepada siapapun termasuk petugas._',
  'Gunakan kode verifikasi berikut untuk masuk ke *{{app_name}}*:\n\n*{{otp}}*\n\n_Masa berlaku kode {{expiry_minutes}} menit. Rahasiakan kode ini demi keamanan akun Anda._',
  '*KEAMANAN AKUN {{app_name}}*\n\nPermintaan kode verifikasi telah diterima. Kode OTP Anda:\n\n*{{otp}}*\n\n_Berlaku {{expiry_minutes}} menit. Pihak {{app_name}} tidak pernah meminta kode rahasia ini._',
  'Halo! Ini adalah kode OTP untuk akses akun *{{app_name}}* Anda:\n\n*{{otp}}*\n\n_Kode aktif selama {{expiry_minutes}} menit. Abaikan pesan ini bila Anda tidak merasa memintanya._',
];

export const OTP_PLACEHOLDERS = ['{{otp}}', '{{app_name}}', '{{expiry_minutes}}'];

export const templateHasOtpPlaceholder = (template) =>
  typeof template === 'string' && template.includes('{{otp}}');

export const generateRefId = (length = 5) => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
};

export const parseSpintax = (text) => {
  if (typeof text !== 'string') return '';
  let result = text;
  const spintaxRegex = /\{([^{}]+)\}/;

  while (spintaxRegex.test(result)) {
    result = result.replace(spintaxRegex, (_, match) => {
      const choices = match.split('|');
      const chosen = choices[Math.floor(Math.random() * choices.length)];
      return chosen.trim();
    });
  }

  return result;
};

export const buildOtpMessage = ({
  otp,
  appName = 'WhatsApp Gateway',
  expiryMinutes = 5,
  template,
  templateIndex,
  includeRef = true,
}) => {
  const safeOtp = String(otp);
  const safeApp = String(appName);
  const safeExpiry = String(expiryMinutes);

  let selectedIndex = null;
  let rawText;

  if (typeof template === 'string' && template.trim().length > 0) {
    rawText = template.trim();
  } else {
    const poolSize = DEFAULT_OTP_TEMPLATES.length;
    const parsedIndex = Number(templateIndex);
    if (Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex < poolSize) {
      selectedIndex = parsedIndex;
    } else {
      selectedIndex = Math.floor(Math.random() * poolSize);
    }
    rawText = DEFAULT_OTP_TEMPLATES[selectedIndex];
  }

  let formattedText = rawText
    .replaceAll('{{otp}}', safeOtp)
    .replaceAll('{{app_name}}', safeApp)
    .replaceAll('{{expiry_minutes}}', safeExpiry);

  formattedText = parseSpintax(formattedText);

  let refId = null;
  if (includeRef) {
    refId = generateRefId(5);
    formattedText = `${formattedText}\n\nRef: #${refId}`;
  }

  return {
    text: formattedText,
    templateIndex: selectedIndex,
    refId,
  };
};
