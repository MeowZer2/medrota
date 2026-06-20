const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { normalizeRole, isValidRole } = require('../lib/roles');
const { isAllowedSpecialty } = require('../lib/medicalSpecialties');

const router = express.Router();

const USER_CATEGORIES = new Set(['admin_leadership', 'physician_trainee', 'other']);
const CLINICAL_IDENTITIES = new Set(['resident', 'medical_student', 'attending', 'other']);

// POST /api/auth/register
router.post('/register', async (req, res) => {
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      category: category ?? null,
      clinicalIdentity: clinicalIdentity ?? null,
      desiredRole: desiredRole ?? null,
      homeSpecialty: homeSpecialty ?? null,
    },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  // If an invite token is supplied, link via invite
  if (inviteToken) {
    try {
      const invite = await prisma.invite.findUnique({ where: { token: inviteToken } });
      if (invite && !invite.usedAt) {
        await prisma.programMember.create({
          data: { programId: invite.programId, userId: user.id, role: normalizeRole(invite.role) },
        });
        await prisma.invite.update({
          where: { token: inviteToken },
          data:  { usedAt: new Date() },
        });
      }
    } catch (inviteErr) {
      console.error('[register] Failed to apply invite token:', inviteErr);
    }
  }

  res.status(201).json({ user });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, orgId: user.orgId },
  });
});

// POST /api/auth/request-access
router.post('/request-access', async (req, res) => {
  const { name, country } = req.body;

  if (!name || !country) {
    return res.status(400).json({ error: 'name and country are required' });
  }

  const org = await prisma.organization.create({
    data: { name, country, status: 'pending' },
    select: { id: true, name: true, country: true, status: true, createdAt: true },
  });

  res.status(201).json({ organization: org });
});

module.exports = router;
