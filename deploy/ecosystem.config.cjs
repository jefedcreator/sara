// pm2 app definition. Started by deploy/deploy.sh with APP_NAME and APP_PORT
// already exported, so this one file serves any app in the fleet.
//
// cwd is the stable /srv/<app>/current path rather than a resolved release
// path: pm2 stores the string and the kernel resolves the symlink at spawn
// time, so `pm2 restart` after a symlink swap picks up the new release without
// a delete/re-add cycle.
const path = require('path');

const appName = process.env.APP_NAME;
if (!appName) {
  throw new Error('APP_NAME must be set before pm2 reads this config');
}

const appPort = process.env.APP_PORT;
if (!appPort) {
  throw new Error('APP_PORT must be set before pm2 reads this config');
}

const appRoot = path.resolve(`/srv/${appName}/current`);
const logDir = path.resolve(`/srv/${appName}/shared/logs`);

/** @type {{ NODE_ENV: string; PORT: string; HOSTNAME: string; CHROME_PATH?: string; DISPLAY?: string }} */
const env = {
  NODE_ENV: 'production',
  PORT: appPort,
  // Bind loopback only. The app is reachable exclusively through nginx; the
  // port is never opened in firewalld.
  HOSTNAME: '127.0.0.1',
};

if (process.env.CHROME_PATH) {
  env.CHROME_PATH = process.env.CHROME_PATH;
  env.DISPLAY = process.env.DISPLAY || ':99';
}

module.exports = {
  apps: [
    {
      name: appName,
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: appRoot,
      env,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 5000,
      treekill: true,
      max_memory_restart: '1G',
      error_file: path.join(logDir, 'pm2-error.log'),
      out_file: path.join(logDir, 'pm2-out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};

