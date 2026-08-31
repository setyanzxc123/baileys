export const notFoundHandler = (req, res) => {
  return res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: `Endpoint '${req.method} ${req.path}' tidak ditemukan.`,
  });
};

export const errorHandler = (err, req, res, next) => {
  const isClientError = Number.isInteger(err.status) && err.status >= 400 && err.status < 500;
  const status = isClientError ? err.status : 500;
  const message = isClientError && err.expose && err.message
    ? err.message
    : 'Terjadi kesalahan internal saat memproses permintaan.';

  if (!isClientError) {
    console.error(`[HTTP] Unhandled error pada ${req.method} ${req.path}:`, err);
  }

  return res.status(status).json({
    status: 'error',
    code: isClientError ? (err.type || 'BAD_REQUEST') : 'INTERNAL_ERROR',
    message,
  });
};
