module.exports = {
  apps: [
    {
      name: 'dprd-wa-gateway',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      // Poller /health + alarm koneksi WhatsApp (lihat scripts/monitor.js).
      // Tanpa monitor: jalankan `pm2 start ecosystem.config.cjs --only dprd-wa-gateway`.
      name: 'dprd-wa-monitor',
      script: 'scripts/monitor.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
    },
  ],
};
