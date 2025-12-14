// PM2 Ecosystem Configuration
// Environment variables are loaded from .env file (Bun does this automatically)

const os = require('os');
const path = require('path');

// Determine Bun interpreter path
const bunPath = process.env.BUN_INSTALL
  ? path.join(process.env.BUN_INSTALL, 'bin', 'bun')
  : path.join(os.homedir(), '.bun', 'bin', 'bun');

// Common PM2 settings to reduce duplication
const commonSettings = {
  instances: 1,
  autorestart: true,
  watch: false,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
};

// NOTE: This config file is kept for reference and potential local use.
// The actual deployment uses individual pm2 start commands in deploy-remote.sh
// to ensure proper Bun interpreter handling.

module.exports = {
  apps: [
    {
      name: 'earthly-web',
      script: 'src/index.ts',
      interpreter: bunPath,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '1G',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      ...commonSettings,
    },
    {
      name: 'earthly-contextvm',
      script: 'contextvm/server.ts',
      interpreter: bunPath,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
      error_file: './logs/contextvm-error.log',
      out_file: './logs/contextvm-out.log',
      ...commonSettings,
    },
  ],
};