const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['dist', 'server.js']) {
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) throw new Error('Cleanup target outside project');
  fs.rmSync(target, { recursive: true, force: true });
}
