const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const dir of ['server', 'public/js', 'test', 'scripts']) {
  for (const file of fs.readdirSync(dir))
    if (file.endsWith('.js'))
      execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['--check', 'server.js'], { stdio: 'inherit' });
console.log('JavaScript syntax checks passed');
