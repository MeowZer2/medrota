require('dotenv').config();

// Deployment hardening: security headers, body limits, health endpoints, and
// the promise that .env.example documents every variable the app reads.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../lib/prisma');
const app = require('../index');

function checkEnvExample() {
  const examplePath = path.join(__dirname, '..', '.env.example');
  assert.ok(fs.existsSync(examplePath), '.env.example must exist');
  const example = fs.readFileSync(examplePath, 'utf8');

  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'APP_BASE_URL', 'CORS_ORIGINS', 'NODE_ENV', 'PORT']) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `.env.example must document ${name}`);
  }

  // It must never contain the real values from this machine's .env.
  const realEnvPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(realEnvPath)) {
    const real = fs.readFileSync(realEnvPath, 'utf8');
    for (const line of real.split(/\r?\n/)) {
      const match = /^([A-Z_]+)=(.+)$/.exec(line.trim());
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, '').trim();
      if (value.length < 8) continue;
      assert.ok(
        !example.includes(value),
        `.env.example must not contain the real value of ${match[1]}`,
      );
    }
  }
}

async function main() {
  let server;
  try {
    checkEnvExample();

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 1. Liveness stays cheap and says nothing sensitive.
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.deepEqual(healthBody, { status: 'ok' });

    // 2. Readiness proves the database answers, without leaking connection details.
    const ready = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(ready.status, 200, 'readiness must pass against a reachable database');
    const readyBody = await ready.json();
    assert.equal(readyBody.database, 'reachable');
    const readyText = JSON.stringify(readyBody);
    assert.ok(!readyText.includes('postgresql://'), 'readiness must not expose the connection string');
    assert.ok(!/password/i.test(readyText), 'readiness must not expose credentials');

    // 3. Security headers are present.
    const headers = health.headers;
    assert.ok(headers.get('content-security-policy'), 'a Content-Security-Policy must be sent');
    assert.match(headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.ok(headers.get('x-frame-options') || /frame-ancestors/.test(headers.get('content-security-policy')));
    assert.equal(headers.get('x-powered-by'), null, 'the express fingerprint must be removed');
    assert.ok(headers.get('referrer-policy'), 'a Referrer-Policy must be sent');

    // 4. An oversized body is refused rather than buffered.
    const oversized = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(400_000) }),
    });
    assert.equal(oversized.status, 413, 'a body over the limit must be rejected with 413');

    // 5. Malformed JSON is a client error, not a 500.
    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email": ',
    });
    assert.equal(malformed.status, 400, 'malformed JSON must be a 400');

    // 6. The public schedule route still works with the headers in place.
    const publicMiss = await fetch(`${baseUrl}/api/public/not-a-real-token`);
    assert.equal(publicMiss.status, 404, 'the public route must still be reachable');

    // 7. Required environment variables are enforced at boot.
    const bootSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(bootSource, /Missing required environment variable/, 'the server must refuse to boot without its secrets');
    assert.match(bootSource, /SIGTERM/, 'SIGTERM must be handled');
    assert.match(bootSource, /SIGINT/, 'SIGINT must be handled');
    assert.match(bootSource, /prisma\.\$disconnect/, 'shutdown must disconnect the database');

    console.log('[deployment-smoke] headers, body limits, health and shutdown wiring checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[deployment-smoke] failed:', error.message);
  process.exitCode = 1;
});
