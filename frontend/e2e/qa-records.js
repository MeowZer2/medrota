// Naming contract for records the browser suite creates in the QA program.
//
// The product has no hard delete: a registry record can only be deactivated. So
// every record a spec creates has to be removable from outside the app, and the
// only safe way to know which ones those are is the name. Anything a spec adds
// is named with this prefix; `backend/scripts/qa-e2e-cleanup.js` deletes exactly
// those, and `dev:seed-qa` sweeps the same set on the way in. A developer's own
// QA records - which use the plain `QA_ONLY` prefix - are never touched.
export const E2E_PREFIX = 'QA_ONLY E2E';

/** A unique, clearly-owned name. Unique because specs share one QA program. */
export function ownedName(label) {
  return `${E2E_PREFIX} ${label} ${Date.now()}`;
}
