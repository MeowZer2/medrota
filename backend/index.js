require('dotenv').config();
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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
