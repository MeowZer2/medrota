const express = require('express');
const auth = require('../middleware/auth');
const { getProgramIdForBlock, requireProgramPermission } = require('../lib/roles');
const { listAuditEvents, readableCategories } = require('../services/auditLog');

const router = express.Router();
router.use(auth);

// GET /api/audit?programId=[&blockId=][&limit=]
//
// Read-only. Program Admin and Program Director see everything; a Chief
// Resident sees scheduling history only; a Viewer sees nothing at all.
router.get('/', async (req, res) => {
  const { programId, blockId, limit } = req.query;
  try {
    let resolvedProgramId = programId;
    if (!resolvedProgramId && blockId) {
      const blockAccess = await getProgramIdForBlock(blockId);
      if (!blockAccess?.programId) return res.status(404).json({ error: 'Block not found' });
      resolvedProgramId = blockAccess.programId;
    }
    if (!resolvedProgramId) return res.status(400).json({ error: 'programId or blockId required' });

    // A block filter must not be usable to reach another program's history.
    if (blockId) {
      const blockAccess = await getProgramIdForBlock(blockId);
      if (blockAccess?.programId !== resolvedProgramId) {
        return res.status(400).json({ error: 'Block does not belong to this program' });
      }
    }

    const membership = await requireProgramPermission(req, res, resolvedProgramId, 'view_audit_history');
    if (!membership) return;

    const result = await listAuditEvents({
      programId: resolvedProgramId,
      blockId: blockId || null,
      role: membership.role,
      limit,
    });
    res.json(result);
  } catch (err) {
    console.error('[audit GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to load audit history' });
  }
});

module.exports = router;
