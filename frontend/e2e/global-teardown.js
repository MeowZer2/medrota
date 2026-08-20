import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');

// Specs create real registry records - that is the only way to exercise adding,
// renaming, deactivating and restoring - and the product has no hard delete, so
// nothing in the app can remove them again. This gives every run a matching
// close: the records the suite owns (`QA_ONLY E2E ...`, inside the QA program)
// are deleted, and nothing else is touched. `dev:seed-qa` does the same sweep on
// the way in, so a crashed run cannot leave residue either.
export default function globalTeardown() {
  try {
    const output = execFileSync(process.execPath, [join('scripts', 'qa-e2e-cleanup.js')], {
      cwd: backendRoot,
      encoding: 'utf8',
    });
    process.stdout.write(output);
  } catch (error) {
    // A cleanup failure must not turn a green suite red; it is reported loudly
    // instead, and the next seed sweeps up whatever was left.
    process.stderr.write(`[e2e teardown] QA cleanup failed: ${error.message}\n`);
  }
}
