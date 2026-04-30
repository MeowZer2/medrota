const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// POST /api/organizations
router.post('/', async (req, res) => {
  const { name, country } = req.body;
  console.log(`[organizations POST] userId=${req.user?.userId} name="${name}" country="${country}"`);

  if (!name || !country) {
    return res.status(400).json({ error: 'name and country are required' });
  }
  try {
    const org = await prisma.organization.create({
      data: { name, country, status: 'active' },
      select: { id: true, name: true, country: true, status: true, createdAt: true },
    });
    console.log(`[organizations POST] Created org id=${org.id}`);
    res.status(201).json({ organization: org });
  } catch (err) {
    console.error('[organizations POST] Prisma error:', err.message);
    console.error(err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

module.exports = router;
