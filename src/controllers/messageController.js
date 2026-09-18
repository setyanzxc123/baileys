import { waClient } from '../services/baileysService.js';
import { config } from '../config/app.js';
import { OTP_PATTERN, DEFAULT_APP_NAME } from '../config/constants.js';
import { buildOtpMessage } from '../utils/otpTemplateHelper.js';

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
  const {
    phone,
    otp,
    app_name,
    template,
    template_index,
    expiry_minutes,
    include_ref,
    wait_for_ack,
    ack_timeout_ms,
  } = req.body || {};

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
  const expiry = Number.isInteger(Number(expiry_minutes)) && Number(expiry_minutes) > 0
    ? Number(expiry_minutes)
    : (config.otp?.defaultExpiryMinutes || 5);
  const shouldIncludeRef = include_ref !== undefined
    ? Boolean(include_ref)
    : (config.otp?.includeRef !== false);

  const { text: textMessage, templateIndex, refId } = buildOtpMessage({
    otp,
    appName: appTitle,
    expiryMinutes: expiry,
    template,
    templateIndex: template_index,
    includeRef: shouldIncludeRef,
  });

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
        template_index: templateIndex,
        ref_id: refId,
      },
    });
  } catch (error) {
    return resolveSendError(res, error, 'SEND_FAILED');
  }
};
