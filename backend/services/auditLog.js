// Append-only audit trail.
//
// This is not application logging. It records who changed what, in terms a
// program can review months later. Metadata describes the change; it is never
// a copy of the request body, and it never carries credentials, tokens or
// anything the reader could not already see in the UI.

const prisma = require('../lib/prisma');

const CATEGORY = Object.freeze({
  SCHEDULING: 'scheduling',
  ADMINISTRATIVE: 'administrative',
});

// Every action the application may record, with the category that decides who
// can read it. Anything not listed here is rejected, so a typo cannot quietly
// create an unreadable category.
const ACTIONS = Object.freeze({
  MEMBER_ROLE_CHANGED: CATEGORY.ADMINISTRATIVE,
  MEMBER_INVITED: CATEGORY.ADMINISTRATIVE,
  PROGRAM_CALL_TYPES_CHANGED: CATEGORY.ADMINISTRATIVE,

  RESIDENT_CREATED: CATEGORY.SCHEDULING,
  RESIDENT_UPDATED: CATEGORY.SCHEDULING,
  RESIDENT_REMOVED: CATEGORY.SCHEDULING,
  BLOCK_AVAILABILITY_CHANGED: CATEGORY.SCHEDULING,
  BLOCK_SETTINGS_CHANGED: CATEGORY.SCHEDULING,
  ASSIGNMENT_CHANGED: CATEGORY.SCHEDULING,
  OVERRIDE_CONFIRMED: CATEGORY.SCHEDULING,
  SCHEDULE_GENERATED: CATEGORY.SCHEDULING,
  SCHEDULE_CLEARED: CATEGORY.SCHEDULING,
  SCHEDULE_PUBLISHED: CATEGORY.SCHEDULING,
  SCHEDULE_UNPUBLISHED: CATEGORY.SCHEDULING,
  PUBLIC_LINK_ROTATED: CATEGORY.SCHEDULING,
});

// Keys that must never reach the audit table even if a caller passes them.
const FORBIDDEN_METADATA_KEYS = new Set([
  'password', 'passwordhash', 'newpassword', 'currentpassword',
  'token', 'jwt', 'authorization', 'secret', 'apikey',
  'publictoken', 'invitetoken', 'accesstoken', 'refreshtoken',
]);

const MAX_METADATA_BYTES = 4000;

/**
 * Strip anything sensitive and keep the result small.
 *
 * Audit metadata should describe what changed, not become a shadow copy of the
 * database, so nested structures are capped and long strings truncated.
 */
function sanitizeMetadata(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 3) return '[nested]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map(item => sanitizeMetadata(item, depth + 1));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) continue;
      output[key] = sanitizeMetadata(item, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return value;
}

function capMetadata(metadata) {
  const clean = sanitizeMetadata(metadata);
  if (clean === null) return null;
  const encoded = JSON.stringify(clean);
  if (encoded.length <= MAX_METADATA_BYTES) return clean;
  return { truncated: true, note: 'Metadata exceeded the audit size limit and was dropped.' };
}

function buildEvent({ programId, blockId, actorUserId, action, entityType, entityId, summary, metadata }) {
  const category = ACTIONS[action];
  if (!category) throw new Error(`Unknown audit action: ${action}`);
  if (!programId) throw new Error(`Audit event ${action} requires a programId`);
  if (!summary) throw new Error(`Audit event ${action} requires a summary`);

  return {
    programId,
    blockId: blockId ?? null,
    actorUserId: actorUserId ?? null,
    action,
    category,
    entityType,
    entityId: entityId ?? null,
    summary,
    metadataJson: capMetadata(metadata),
  };
}

/**
 * Record an event inside an existing transaction.
 *
 * Use this wherever the audit record must be inseparable from the mutation:
 * if the mutation rolls back, so does its audit row.
 */
function recordAuditEventTx(tx, input) {
  return tx.auditEvent.create({ data: buildEvent(input) });
}

/**
 * Record an event outside a transaction.
 *
 * Never allowed to fail the request it describes: a broken audit write is
 * logged and swallowed rather than turning a successful mutation into a 500.
 */
async function recordAuditEvent(input) {
  try {
    return await prisma.auditEvent.create({ data: buildEvent(input) });
  } catch (err) {
    console.error('[audit] failed to record event:', input?.action, err.message);
    return null;
  }
}

/** Which categories may this role read? */
function readableCategories(role) {
  if (role === 'program_admin' || role === 'program_director') {
    return [CATEGORY.SCHEDULING, CATEGORY.ADMINISTRATIVE];
  }
  if (role === 'chief_resident') return [CATEGORY.SCHEDULING];
  return [];
}

async function listAuditEvents({ programId, blockId, role, limit = 100 }) {
  const categories = readableCategories(role);
  if (categories.length === 0) return { events: [], categories };

  const events = await prisma.auditEvent.findMany({
    where: {
      programId,
      category: { in: categories },
      ...(blockId ? { blockId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    include: { actorUser: { select: { id: true, name: true } } },
  });

  return {
    categories,
    events: events.map(event => ({
      id: event.id,
      action: event.action,
      category: event.category,
      entityType: event.entityType,
      entityId: event.entityId,
      summary: event.summary,
      metadata: event.metadataJson,
      blockId: event.blockId,
      actorName: event.actorUser?.name ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

module.exports = {
  ACTIONS,
  CATEGORY,
  recordAuditEvent,
  recordAuditEventTx,
  listAuditEvents,
  readableCategories,
  sanitizeMetadata,
};
