const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { normalizeRole, isValidRole } = require('../lib/roles');
const { isAllowedSpecialty } = require('../lib/medicalSpecialties');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const USER_CATEGORIES = new Set(['admin_leadership', 'physician_trainee', 'other']);
const CLINICAL_IDENTITIES = new Set(['resident', 'medical_student', 'attending', 'other']);
const MIN_PASSWORD_LENGTH = 10;
const authLimit = process.env.NODE_ENV === 'production' ? 10 : 50;
const loginLimiter = createRateLimiter({ max: authLimit, message: 'Too many login attempts. Try again later.' });
const registrationLimiter = createRateLimiter({ max: authLimit, message: 'Too many registration attempts. Try again later.' });
const requestAccessLimiter = createRateLimiter({ max: authLimit });

// POST /api/auth/register
router.post('/register', registrationLimiter, async (req, res) => {
  const {
    name,
    email,
    password,
    inviteToken,
    category,
    clinicalIdentity,
    desiredRole,
    homeSpecialty,
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (category && !USER_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Invalid user category' });
  }
  if (clinicalIdentity && !CLINICAL_IDENTITIES.has(clinicalIdentity)) {
    return res.status(400).json({ error: 'Invalid clinical identity' });
  }
  if (desiredRole && !isValidRole(desiredRole)) {
    return res.status(400).json({ error: 'Invalid desired role' });
  }
  if (homeSpecialty && !isAllowedSpecialty(homeSpecialty)) {
    return res.status(400).json({ error: 'Invalid home specialty' });
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
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        category: category ?? null,
        clinicalIdentity: clinicalIdentity ?? null,
        desiredRole: desiredRole ?? null,
        homeSpecialty: homeSpecialty ?? null,
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (invite) {
      await tx.programMember.create({
        data: { programId: invite.programId, userId: created.id, role: normalizeRole(invite.role) },
      });
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error('Invite link has already been used');
    }
    return created;
  });

  res.status(201).json({ user });
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
