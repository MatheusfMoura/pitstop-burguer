module.exports = {
  apps: [
    {
      name: 'whatsapp-delivery',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        RESTAURANTE_NOME: 'Pitstop Burguer'
      }
    }
  ]
};
