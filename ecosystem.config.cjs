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
  ],
};
