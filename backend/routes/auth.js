const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { normalizeRole } = require('../lib/roles');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 10;
// Credential-stuffing protection is a production concern, so production keeps a
// tight budget. Outside production the limiter only has to stay out of the way:
// the browser E2E suite alone signs in more than fifty times inside one window,
// and throttling it produced 429s that looked like unrelated login failures.
const authLimit = process.env.NODE_ENV === 'production' ? 10 : 500;
const loginLimiter = createRateLimiter({ max: authLimit, message: 'Too many login attempts. Try again later.' });
const registrationLimiter = createRateLimiter({ max: authLimit, message: 'Too many registration attempts. Try again later.' });
const requestAccessLimiter = createRateLimiter({ max: authLimit });

// POST /api/auth/register
// Registration asks for a name, an email and a password, and nothing else.
//
// The user columns category, clinicalIdentity, desiredRole and homeSpecialty are
// deprecated: they were collected but never read anywhere in the product, and a
// self-declared desiredRole must never influence privileges. They are no longer
// accepted or written; the columns remain so existing rows are not disturbed.
router.post('/register', registrationLimiter, async (req, res) => {
  const { name, email, password, inviteToken } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });
  if (existing) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const invite = inviteToken
    ? await prisma.invite.findUnique({ where: { token: inviteToken } })
    : null;
  if (inviteToken && (!invite || invite.usedAt)) {
    return res.status(400).json({ error: 'Invite link is invalid or has already been used' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { user, joinedProgramId } = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
      },
      select: { id: true, name: true, email: true, orgId: true, createdAt: true },
    });
    if (!invite) return { user: created, joinedProgramId: null };

    // The invitation is authoritative for the role. Nothing the registrant
    // supplies can change it.
    await tx.programMember.create({
      data: { programId: invite.programId, userId: created.id, role: normalizeRole(invite.role) },
    });
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error('Invite link has already been used');
    return { user: created, joinedProgramId: invite.programId };
  });

  // Sign the new user straight in rather than making them retype what they just
  // typed. The token is identical to the one /login issues.
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, orgId: user.orgId },
    joinedProgramId,
  });
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, orgId: user.orgId },
  });
});

// POST /api/auth/request-access
router.post('/request-access', requestAccessLimiter, (_req, res) => {
  res.status(410).json({ error: 'Request access is not available. Use a program invite or create a program after registration.' });
});

module.exports = router;
