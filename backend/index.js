require('dotenv').config();

for (const name of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const prisma = require('./lib/prisma');
const authRoutes = require('./routes/auth');
const residentsRoutes = require('./routes/residents');
const attendingRoutes = require('./routes/attending');
const programsRoutes = require('./routes/programs');
const assignmentsRoutes = require('./routes/assignments');
const organizationsRoutes = require('./routes/organizations');
const scheduleRoutes = require('./routes/schedule');
const publicRoutes = require('./routes/public');
const blocksRoutes = require('./routes/blocks');
const attendingTemplateRoutes = require('./routes/attendingTemplate');
const flagsRoutes = require('./routes/flags');
const auditRoutes = require('./routes/audit');
const programConfigurationRoutes = require('./routes/programConfiguration');

const app = express();
const PORT = process.env.PORT || 3000;
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];
const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : defaultOrigins);

// Security headers. The API serves JSON and file downloads only, never HTML, so
// a restrictive Content-Security-Policy costs nothing here. Cross-origin
// resource policy is relaxed to same-site because the Vite dev server and the
// production frontend are served from a different origin than the API.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  // The API is not a browsing context; HSTS belongs on whatever terminates TLS.
  hsts: process.env.NODE_ENV === 'production',
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));

// No endpoint legitimately accepts a large body; the biggest is a block of
// attending entries. A cap keeps a malformed or hostile request cheap.
app.use(express.json({ limit: '256kb' }));

// ── Request logger ─────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.path}`, req.headers.authorization ? 'has-token' : 'no-token');
  next();
});

// ── Public routes (no auth) ────────────────────────────────────────────────────
app.use('/api/public', publicRoutes);

// ── Protected routes ───────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/residents', residentsRoutes);
app.use('/api/attending', attendingRoutes);
app.use('/api/programs', programsRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/attending-template', attendingTemplateRoutes);
app.use('/api/flags', flagsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/program-configuration', programConfigurationRoutes);

// Liveness: is the process up? Deliberately says nothing about the database or
// the environment, so it is safe to expose to a load balancer.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: can the process actually serve requests? Reports whether the
// database answers, and never leaks the connection string or the driver error.
app.get('/api/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'reachable' });
  } catch (err) {
    console.error('[health/ready] database unreachable:', err.message);
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  // A malformed JSON body is the client's mistake, not a server fault.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(500).json({ error: message });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Stop accepting connections, let in-flight requests finish, then close the
  // database pool. Without this a redeploy can cut a transaction mid-write.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, closing server`);

    const forced = setTimeout(() => {
      console.error('[shutdown] in-flight requests did not finish in time, exiting');
      process.exit(1);
    }, 10_000);
    forced.unref();

    server.close(async (err) => {
      if (err) console.error('[shutdown] error closing server:', err.message);
      try {
        await prisma.$disconnect();
        console.log('[shutdown] database disconnected');
      } catch (disconnectError) {
        console.error('[shutdown] error disconnecting database:', disconnectError.message);
      }
      clearTimeout(forced);
      process.exit(err ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
