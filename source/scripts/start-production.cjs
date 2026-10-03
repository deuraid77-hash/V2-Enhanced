const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('Build the dashboard first: npm run build');
  process.exit(1);
}
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
