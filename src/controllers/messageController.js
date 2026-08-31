import { waClient } from '../services/baileysService.js';
import { config } from '../config/app.js';
import { OTP_PATTERN, DEFAULT_APP_NAME, DEFAULT_DOC_NAME, DEFAULT_DOC_MIMETYPE } from '../config/constants.js';

export const sendMessage = async (req, res) => {
  const { phone, message, text } = req.body || {};
  const content = message || text;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!content) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'message' (atau 'text') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendMessage(phone, content);
    return res.json({
      status: 'success',
      message: 'Pesan berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim pesan WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_FAILED',
    });
  }
};

export const sendOtp = async (req, res) => {
  const { phone, otp, app_name, template } = req.body || {};

  if (!phone || !otp) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' dan 'otp' wajib diisi.",
    });
  }

  if (!OTP_PATTERN.test(String(otp))) {
    return res.status(422).json({
      status: 'error',
      code: 'OTP_INVALID_FORMAT',
      message: "Parameter 'otp' harus berupa 4-8 digit angka.",
    });
  }

  const appTitle = app_name || config.serviceName || DEFAULT_APP_NAME;
  const defaultText = `*KODE VERIFIKASI LOGIN*\n\nKode OTP Anda untuk portal *${appTitle}* adalah:\n\n*${otp}*\n\n_Kode ini berlaku selama 5 menit. Jangan berikan kode ini kepada siapapun termasuk petugas._`;
  const textMessage = template ? template.replace('{{otp}}', String(otp)).replace('{{app_name}}', appTitle) : defaultText;

  try {
    const result = await waClient.sendMessage(phone, textMessage);
    return res.json({
      status: 'success',
      message: 'Kode OTP berhasil dikirim via WhatsApp.',
      data: {
        ...result,
        otp_length: String(otp).length,
      },
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim kode OTP WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_FAILED',
    });
  }
};

export const sendDocument = async (req, res) => {
  const { phone, document_url, url, file_name, filename, caption, mimetype } = req.body || {};
  const docUrl = document_url || url;
  const docName = file_name || filename || DEFAULT_DOC_NAME;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!docUrl) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'document_url' (atau 'url') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendDocument(phone, docUrl, {
      fileName: docName,
      caption: caption || '',
      mimetype: mimetype || DEFAULT_DOC_MIMETYPE,
    });

    return res.json({
      status: 'success',
      message: 'Dokumen berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim dokumen WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_DOCUMENT_FAILED',
    });
  }
};

export const sendImage = async (req, res) => {
  const { phone, image_url, url, caption } = req.body || {};
  const imgUrl = image_url || url;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!imgUrl) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'image_url' (atau 'url') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendImage(phone, imgUrl, caption || '');
    return res.json({
      status: 'success',
      message: 'Gambar berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim gambar WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_IMAGE_FAILED',
    });
  }
};

export const sendBulk = async (req, res) => {
  const { recipients, delay_ms } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'recipients' harus berupa array yang berisi daftar pesan ({ phone, message }).",
    });
  }

  if (recipients.length > config.bulk.maxRecipients) {
    return res.status(422).json({
      status: 'error',
      code: 'BULK_TOO_MANY_RECIPIENTS',
      message: `Maksimal ${config.bulk.maxRecipients} penerima per permintaan (diterima: ${recipients.length}). Pecah pengiriman menjadi beberapa permintaan bertahap.`,
    });
  }

  const delay = Number(delay_ms);
  if (delay_ms !== undefined && (!Number.isFinite(delay) || delay < config.bulk.minDelayMs)) {
    return res.status(422).json({
      status: 'error',
      code: 'BULK_DELAY_TOO_SHORT',
      message: `Parameter 'delay_ms' minimal ${config.bulk.minDelayMs} ms agar jeda anti-spam antar pesan tetap efektif.`,
    });
  }

  try {
    const result = await waClient.sendBulk(recipients, delay_ms || config.bulk.defaultDelayMs);
    return res.json({
      status: 'success',
      message: `Proses pengiriman bulk selesai. Berhasil: ${result.success_count}, Gagal: ${result.failed_count}`,
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal menjalankan pengiriman massal.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'BULK_FAILED',
    });
  }
};

export const checkNumber = async (req, res) => {
  const { phone } = req.body || {};

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  try {
    const result = await waClient.checkNumber(phone);
    return res.json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal memeriksa nomor telepon.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'CHECK_FAILED',
    });
  }
};
