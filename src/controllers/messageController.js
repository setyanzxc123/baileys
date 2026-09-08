import { waClient } from '../services/baileysService.js';
import { queueService } from '../services/queueService.js';
import { config } from '../config/app.js';
import { OTP_PATTERN, DEFAULT_APP_NAME, DEFAULT_DOC_NAME, DEFAULT_DOC_MIMETYPE } from '../config/constants.js';

const resolveSendError = (res, error, fallbackCode) => {
  if (error?.statusCode === 429) {
    const resHeaders = { 'Retry-After': String(Math.ceil((error.retryAfterMs || 1000) / 1000)) };
    return res.status(429).set(resHeaders).json({
      status: 'error',
      code: error.code || 'WA_SENDER_LIMIT',
      message: error.message,
    });
  }
  if (error?.statusCode === 422) {
    return res.status(422).json({
      status: 'error',
      code: error.code || fallbackCode,
      message: error.message,
    });
  }
  if (error?.statusCode === 502) {
    return res.status(502).json({
      status: 'error',
      code: error.code || 'WA_SERVER_REJECTED',
      message: error.message,
      server_error_code: error.serverErrorCode || null,
    });
  }
  if (error?.statusCode === 504) {
    return res.status(504).json({
      status: 'error',
      code: error.code || 'WA_SERVER_ACK_TIMEOUT',
      message: error.message,
    });
  }
  if (error?.statusCode === 503) {
    return res.status(503).json({
      status: 'error',
      code: error.code || 'WA_GATEWAY_OFFLINE',
      message: error.message,
    });
  }
  const isOffline = !waClient.getStatus().connected;
  return res.status(isOffline ? 503 : 500).json({
    status: 'error',
    message: error.message || 'Gagal mengirim pesan WhatsApp.',
    code: isOffline ? 'WA_GATEWAY_OFFLINE' : fallbackCode,
  });
};

export const sendMessage = async (req, res) => {
  const { phone, to, jid, recipient, message, text, wait_for_ack, ack_timeout_ms } = req.body || {};
  const target = phone || to || jid || recipient;
  const content = message || text;

  if (!target) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' (atau 'to', 'jid') wajib diisi.",
    });
  }

  if (!content) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'message' (atau 'text') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendMessage(target, content, {
      waitForAck: wait_for_ack,
      ackTimeoutMs: ack_timeout_ms,
    });
    return res.json({
      status: 'success',
      message: 'Pesan berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    return resolveSendError(res, error, 'SEND_FAILED');
  }
};

export const sendOtp = async (req, res) => {
  const { phone, otp, app_name, template, wait_for_ack, ack_timeout_ms } = req.body || {};

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
    const result = await waClient.sendMessage(phone, textMessage, {
      waitForAck: wait_for_ack,
      ackTimeoutMs: ack_timeout_ms,
    });
    return res.json({
      status: 'success',
      message: 'Kode OTP berhasil dikirim via WhatsApp.',
      data: {
        ...result,
        otp_length: String(otp).length,
      },
    });
  } catch (error) {
    return resolveSendError(res, error, 'SEND_FAILED');
  }
};

export const sendDocument = async (req, res) => {
  const { phone, to, jid, recipient, document_url, url, file_name, filename, caption, mimetype, wait_for_ack, ack_timeout_ms } = req.body || {};
  const target = phone || to || jid || recipient;
  const docFile = req.file?.buffer;
  const docUrl = document_url || url;
  const docSource = docFile || docUrl;
  const docName = file_name || filename || req.file?.originalname || DEFAULT_DOC_NAME;
  const mime = mimetype || req.file?.mimetype || DEFAULT_DOC_MIMETYPE;

  if (!target) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' (atau 'to', 'jid') wajib diisi.",
    });
  }

  if (!docSource) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'file' (upload) atau 'document_url' (atau 'url') wajib disertakan.",
    });
  }

  try {
    const result = await waClient.sendDocument(target, docSource, {
      fileName: docName,
      caption: caption || '',
      mimetype: mime,
      waitForAck: wait_for_ack,
      ackTimeoutMs: ack_timeout_ms,
    });

    return res.json({
      status: 'success',
      message: 'Dokumen berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    return resolveSendError(res, error, 'SEND_DOCUMENT_FAILED');
  }
};

export const sendImage = async (req, res) => {
  const { phone, to, jid, recipient, image_url, url, caption, wait_for_ack, ack_timeout_ms } = req.body || {};
  const target = phone || to || jid || recipient;
  const imgFile = req.file?.buffer;
  const imgUrl = image_url || url;
  const imgSource = imgFile || imgUrl;

  if (!target) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' (atau 'to', 'jid') wajib diisi.",
    });
  }

  if (!imgSource) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'file' (upload) atau 'image_url' (atau 'url') wajib disertakan.",
    });
  }

  try {
    const result = await waClient.sendImage(target, imgSource, caption || '', {
      waitForAck: wait_for_ack,
      ackTimeoutMs: ack_timeout_ms,
    });
    return res.json({
      status: 'success',
      message: 'Gambar berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    return resolveSendError(res, error, 'SEND_IMAGE_FAILED');
  }
};

export const sendBulk = (req, res) => {
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

  const isOffline = !waClient.getStatus().connected;
  if (isOffline) {
    return res.status(503).json({
      status: 'error',
      message: 'WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.',
      code: 'WA_GATEWAY_OFFLINE',
    });
  }

  const job = queueService.createBulkJob(recipients, { delayMs: delay_ms || config.bulk.defaultDelayMs });

  return res.status(202).json({
    status: 'queued',
    message: 'Permintaan pengiriman massal diterima dan sedang diproses di antrean.',
    job_id: job.id,
    total: job.total,
    check_status_url: `/jobs/${job.id}`,
  });
};

export const getJobStatus = (req, res) => {
  const { job_id } = req.params;
  const job = queueService.getJob(job_id);

  if (!job) {
    return res.status(404).json({
      status: 'error',
      code: 'JOB_NOT_FOUND',
      message: `Job dengan ID '${job_id}' tidak ditemukan.`,
    });
  }

  return res.json({
    status: 'success',
    data: job,
  });
};

export const checkNumber = async (req, res) => {
  const { phone, to, recipient } = req.body || {};
  const target = phone || to || recipient;

  if (!target) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  try {
    const result = await waClient.checkNumber(target);
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
