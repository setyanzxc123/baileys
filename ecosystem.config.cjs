module.exports = {
  apps: [
    {
      name: 'wa-gateway',
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
      name: 'wa-monitor',
      script: 'scripts/monitor.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
    },
  ],
};
