const prisma = require('./prisma');

function cleanActivityName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeActivityName(value) {
  return cleanActivityName(value).toLocaleLowerCase('en-CA');
}

async function resolveActivityType(programId, label, { allowInactiveId = null } = {}) {
  const cleanLabel = cleanActivityName(label);
  if (!cleanLabel) return { activityLabel: '', activityTypeId: null };
  const normalizedName = normalizeActivityName(cleanLabel);
  let activity = await prisma.attendingActivityType.findUnique({
    where: { programId_normalizedName: { programId, normalizedName } },
  });
  if (!activity) {
    const sortOrder = await prisma.attendingActivityType.count({ where: { programId } });
    activity = await prisma.attendingActivityType.create({
      data: { programId, name: cleanLabel, normalizedName, sortOrder },
    });
  }
  if (!activity.isActive && activity.id !== allowInactiveId) {
    const error = new Error('Attending activity is inactive');
    error.statusCode = 400;
    throw error;
  }
  return { activityLabel: activity.name, activityTypeId: activity.id };
}

module.exports = { cleanActivityName, normalizeActivityName, resolveActivityType };
