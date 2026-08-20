const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const {
  ROLES,
  CONFIGURABLE_CHIEF_PERMISSIONS,
  DEFAULT_CHIEF_PERMISSIONS,
  getMembership,
  requireProgramPermission,
  resolvePermissions,
} = require('../lib/roles');

const router = express.Router();
router.use(auth);

const MAX_SERVICE_DESCRIPTION_LENGTH = 500;

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase('en-CA');
}

function cleanDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateDescription(value, res) {
  if (value.length <= MAX_SERVICE_DESCRIPTION_LENGTH) return true;
  res.status(400).json({ error: `Description must be ${MAX_SERVICE_DESCRIPTION_LENGTH} characters or fewer` });
  return false;
}

function duplicateResponse(err, res, label) {
  if (err?.code === 'P2002') {
    res.status(409).json({ error: `${label} already exists in this program` });
    return true;
  }
  return false;
}

async function requireMembership(req, res, programId) {
  const membership = await getMembership(req.user?.userId, programId);
  if (!membership) res.status(403).json({ error: 'Not a member of this program' });
  return membership;
}

router.get('/:programId/clinical-services', async (req, res) => {
  const { programId } = req.params;
  if (!await requireMembership(req, res, programId)) return;
  const services = await prisma.programService.findMany({
    where: { programId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json(services);
});

router.post('/:programId/clinical-services', async (req, res) => {
  const { programId } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'manage_clinical_services')) return;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Service name is required' });
  const description = cleanDescription(req.body.description);
  if (!validateDescription(description, res)) return;
  try {
    const count = await prisma.programService.count({ where: { programId } });
    const service = await prisma.programService.create({
      data: {
        programId,
        name,
        normalizedName: normalizedName(name),
        description: description || null,
        sortOrder: Number.isInteger(req.body.sortOrder) ? req.body.sortOrder : count,
      },
    });
    res.status(201).json(service);
  } catch (err) {
    if (duplicateResponse(err, res, 'Clinical service')) return;
    console.error('[clinical-services POST]', err.message);
    res.status(500).json({ error: 'Failed to create clinical service' });
  }
});

router.put('/:programId/clinical-services/:id', async (req, res) => {
  const { programId, id } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'manage_clinical_services')) return;
  const existing = await prisma.programService.findUnique({ where: { id } });
  if (!existing || existing.programId !== programId) return res.status(404).json({ error: 'Clinical service not found' });
  const name = req.body.name === undefined ? undefined : cleanName(req.body.name);
  if (name !== undefined && !name) return res.status(400).json({ error: 'Service name is required' });
  const description = req.body.description === undefined ? undefined : cleanDescription(req.body.description);
  if (description !== undefined && !validateDescription(description, res)) return;
  try {
    const service = await prisma.programService.update({
      where: { id },
      data: {
        ...(name !== undefined && { name, normalizedName: normalizedName(name) }),
        ...(description !== undefined && { description: description || null }),
        ...(typeof req.body.isActive === 'boolean' && { isActive: req.body.isActive }),
        ...(Number.isInteger(req.body.sortOrder) && { sortOrder: req.body.sortOrder }),
      },
    });
    res.json(service);
  } catch (err) {
    if (duplicateResponse(err, res, 'Clinical service')) return;
    console.error('[clinical-services PUT]', err.message);
    res.status(500).json({ error: 'Failed to update clinical service' });
  }
});

router.get('/:programId/attending-activities', async (req, res) => {
  const { programId } = req.params;
  if (!await requireMembership(req, res, programId)) return;
  const activities = await prisma.attendingActivityType.findMany({
    where: { programId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { attendingEntries: true, attendingTemplates: true } } },
  });
  res.json(activities);
});

router.post('/:programId/attending-activities', async (req, res) => {
  const { programId } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'manage_attending_roster')) return;
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Activity name is required' });
  try {
    const count = await prisma.attendingActivityType.count({ where: { programId } });
    const activity = await prisma.attendingActivityType.create({
      data: {
        programId,
        name,
        normalizedName: normalizedName(name),
        sortOrder: Number.isInteger(req.body.sortOrder) ? req.body.sortOrder : count,
      },
      include: { _count: { select: { attendingEntries: true, attendingTemplates: true } } },
    });
    res.status(201).json(activity);
  } catch (err) {
    if (duplicateResponse(err, res, 'Attending activity')) return;
    console.error('[attending-activities POST]', err.message);
    res.status(500).json({ error: 'Failed to create attending activity' });
  }
});

router.put('/:programId/attending-activities/:id', async (req, res) => {
  const { programId, id } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'manage_attending_roster')) return;
  const existing = await prisma.attendingActivityType.findUnique({ where: { id } });
  if (!existing || existing.programId !== programId) return res.status(404).json({ error: 'Attending activity not found' });
  const name = req.body.name === undefined ? undefined : cleanName(req.body.name);
  if (name !== undefined && !name) return res.status(400).json({ error: 'Activity name is required' });
  try {
    const activity = await prisma.attendingActivityType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name, normalizedName: normalizedName(name) }),
        ...(typeof req.body.isActive === 'boolean' && { isActive: req.body.isActive }),
        ...(Number.isInteger(req.body.sortOrder) && { sortOrder: req.body.sortOrder }),
      },
      include: { _count: { select: { attendingEntries: true, attendingTemplates: true } } },
    });
    res.json(activity);
  } catch (err) {
    if (duplicateResponse(err, res, 'Attending activity')) return;
    console.error('[attending-activities PUT]', err.message);
    res.status(500).json({ error: 'Failed to update attending activity' });
  }
});

router.get('/:programId/role-permissions', async (req, res) => {
  const { programId } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'configure_role_permissions')) return;
  const chiefPermissions = await resolvePermissions(programId, ROLES.CHIEF_RESIDENT);
  res.json({
    roles: {
      [ROLES.PROGRAM_ADMIN]: { fixed: true, summary: 'Full program access' },
      [ROLES.PROGRAM_DIRECTOR]: { fixed: true, summary: 'Full program access' },
      [ROLES.CHIEF_RESIDENT]: {
        fixed: false,
        permissions: CONFIGURABLE_CHIEF_PERMISSIONS.map(permission => ({
          permission,
          enabled: chiefPermissions.includes(permission),
        })),
        usingLegacyDefaults: !(await prisma.programRolePermission.count({ where: { programId, role: ROLES.CHIEF_RESIDENT } })),
      },
      [ROLES.VIEWER]: { fixed: true, summary: 'Published schedule access only' },
    },
  });
});

router.put('/:programId/role-permissions', async (req, res) => {
  const { programId } = req.params;
  if (!await requireProgramPermission(req, res, programId, 'configure_role_permissions')) return;
  if (req.body.role !== undefined && req.body.role !== ROLES.CHIEF_RESIDENT) {
    return res.status(400).json({ error: 'Only Chief Resident permissions are configurable' });
  }
  if (!Array.isArray(req.body.permissions)) return res.status(400).json({ error: 'permissions must be an array' });
  const requested = [...new Set(req.body.permissions)];
  if (requested.some(permission => !CONFIGURABLE_CHIEF_PERMISSIONS.includes(permission))) {
    return res.status(400).json({ error: 'Permission payload contains a non-configurable permission' });
  }
  await prisma.$transaction(async tx => {
    await tx.programRolePermission.deleteMany({ where: { programId, role: ROLES.CHIEF_RESIDENT } });
    await tx.programRolePermission.createMany({
      data: CONFIGURABLE_CHIEF_PERMISSIONS.map(permission => ({
        programId,
        role: ROLES.CHIEF_RESIDENT,
        permission,
        enabled: requested.includes(permission),
      })),
    });
  });
  res.json({
    role: ROLES.CHIEF_RESIDENT,
    permissions: await resolvePermissions(programId, ROLES.CHIEF_RESIDENT),
    defaults: DEFAULT_CHIEF_PERMISSIONS,
  });
});

module.exports = router;
