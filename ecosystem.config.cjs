/** @type {import('pm2').AppConfig[]} */
module.exports = {
  apps : [{
    name: 'RollForge',
    cwd: '/opt/bots/RollForge',
    script: 'pnpm',
    args: 'start',
    interpreter: 'none',
    watch: false,
    autorestart: true,
    ignore_watch: ['node_modules','.git','package.json'],
    max_restarts: 10,
    env: {
        NODE_ENV: 'development'
    },
    env_production: {
        NODE_ENV: 'production'
    },
    max_memory_restart: "512M",
    // Health behavior
    kill_timeout: 5000,
    listen_timeout: 10000,
    // Log files (PM2 will create these)
    error_file: "/var/log/pm2/RollForge-error.log",
    out_file: "/var/log/pm2/RollForge-out.log",
    merge_logs: true
  }]
};