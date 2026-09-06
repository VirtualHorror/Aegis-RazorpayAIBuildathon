// PM2 process file for the hosted Aegis instance (Decisions.md D-081).
// Intent: one file starts both processes from any checkout — paths resolve from this file, not the cwd — on loopback
//         ports, because nginx (deploy/nginx/aegis.conf) is the only thing that should reach them.
// Flow: pm2 start ecosystem.config.js → aegis-api (node --import tsx src/server.ts; it reads <root>/.env itself)
//       + aegis-web (next start on 127.0.0.1:3000; NEXT_PUBLIC_* come from apps/web/.env.production, written by
//       deploy/sync-web-env.sh before the build) → pm2 save → the systemd unit from deploy/setup-server.sh
//       resurrects both on boot.
const path = require('node:path');

const root = __dirname;
const shared = {
  exec_mode: 'fork',
  // One API per database: the worker leases, the circuit breaker and the BYOK registry live in process memory.
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 2000,
  merge_logs: true,
  time: true,
};

module.exports = {
  apps: [
    {
      ...shared,
      name: 'aegis-api',
      cwd: path.join(root, 'apps', 'api'),
      script: 'src/server.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      // server.ts drains the worker on SIGINT; give it that time before PM2 escalates to SIGKILL.
      kill_timeout: 15000,
      out_file: path.join(root, 'logs', 'api.out.log'),
      error_file: path.join(root, 'logs', 'api.err.log'),
    },
    {
      ...shared,
      name: 'aegis-web',
      cwd: path.join(root, 'apps', 'web'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      out_file: path.join(root, 'logs', 'web.out.log'),
      error_file: path.join(root, 'logs', 'web.err.log'),
    },
  ],
};
