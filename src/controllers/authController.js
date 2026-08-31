import { waClient } from '../services/baileysService.js';

export const getRawQr = (req, res) => {
  const status = waClient.getStatus();
  return res.json({
    status: 'success',
    connected: status.connected,
    qr_available: status.qr_available,
    qr_raw: waClient.qrRaw,
    qr_data_url: waClient.qrDataUrl,
  });
};

export const requestPairCode = async (req, res) => {
  const { phone } = req.body || {};

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  try {
    const result = await waClient.requestPairingCode(phone);
    return res.json({
      status: 'success',
      message: 'Pairing Code berhasil dibuat.',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal membuat Pairing Code.',
    });
  }
};

export const logoutSession = async (req, res) => {
  try {
    await waClient.logout();
    return res.json({
      status: 'success',
      message: 'WhatsApp berhasil logout. Sesi lama telah dibersihkan. Lakukan pairing ulang via POST /pair-code atau GET /qr/raw.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal melakukan logout sesi WhatsApp.',
    });
  }
};

export const restartConnection = async (req, res) => {
  try {
    const previousStatus = waClient.getStatus().status;
    const currentStatus = await waClient.restart();

    return res.json({
      status: 'success',
      message: 'Koneksi WhatsApp dimulai ulang tanpa menghapus sesi. Pantau GET /status hingga connected.',
      data: {
        previous_status: previousStatus,
        current_status: currentStatus.status,
        connected: currentStatus.connected,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal memulai ulang koneksi WhatsApp.',
      code: 'RESTART_FAILED',
    });
  }
};
