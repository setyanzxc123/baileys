import { jidNormalizedUser } from '@whiskeysockets/baileys';

export function cleanPhoneNumber(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, '');

  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  } else if (clean.startsWith('8')) {
    clean = '62' + clean;
  }

  if (clean.length < 10 || clean.length > 15) {
    return null;
  }

  return clean;
}

export function normalizeJid(recipient) {
  if (!recipient) return null;
  const raw = String(recipient).trim();

  if (raw.endsWith('@g.us') || raw.endsWith('@lid')) {
    return null;
  }

  if (raw.endsWith('@s.whatsapp.net')) {
    return jidNormalizedUser(raw);
  }

  const clean = cleanPhoneNumber(raw);
  if (!clean) return null;

  return jidNormalizedUser(`${clean}@s.whatsapp.net`);
}
