const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, inviteToken } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  // If an invite token is supplied, link via invite
  if (inviteToken) {
    try {
      const invite = await prisma.invite.findUnique({ where: { token: inviteToken } });
      if (invite && !invite.usedAt) {
        await prisma.programMember.create({
          data: { programId: invite.programId, userId: user.id, role: invite.role },
        });
        await prisma.invite.update({
          where: { token: inviteToken },
          data:  { usedAt: new Date() },
        });
      }
    } catch (inviteErr) {
      console.error('[register] Failed to apply invite token:', inviteErr);
    }
  } else {
    // Auto-link new user to the first existing Program, if any
    try {
      const firstProgram = await prisma.program.findFirst({ select: { id: true } });
      if (firstProgram) {
        const existingMemberCount = await prisma.programMember.count({
          where: { programId: firstProgram.id },
        });
        const role = existingMemberCount === 0 ? 'admin' : 'viewer';
        await prisma.programMember.create({
          data: { programId: firstProgram.id, userId: user.id, role },
        });
      }
    } catch (linkErr) {
      console.error('[register] Failed to auto-link ProgramMember:', linkErr);
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
