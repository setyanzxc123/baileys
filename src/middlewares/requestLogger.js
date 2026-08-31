export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/qr') && !req.path.startsWith('/health')) {
      console.log(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
};
