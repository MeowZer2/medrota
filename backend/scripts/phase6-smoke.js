const { spawnSync } = require('child_process');

const checks = [
  ['node', ['scripts/phase6-public-privacy-check.js']],
  ['node', ['scripts/phase6-excel-check.js']],
  ['node', ['scripts/phase6-printable-check.js']],
];

for (const [command, args] of checks) {
  const label = [command, ...args].join(' ');
  console.log(`[phase6-smoke] running ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`[phase6-smoke] failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[phase6-smoke] all Phase 6 smoke checks passed');
