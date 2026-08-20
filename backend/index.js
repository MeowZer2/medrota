require('dotenv').config();

for (const name of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}
const express = require('express');
const cors = require('cors');
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

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(500).json({ error: message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
