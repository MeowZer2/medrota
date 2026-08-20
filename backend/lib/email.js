const MAX_EMAIL_LENGTH = 254;

// Contact email validation deliberately covers the useful, interoperable
// shape without pretending to implement the whole RFC grammar. In particular,
// the local part is case-sensitive data and must not be lowercased.
function normalizeOptionalEmail(value) {
  if (typeof value !== 'string') return { valid: false, value: null };

  const trimmed = value.trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > MAX_EMAIL_LENGTH || /\s/.test(trimmed)) return { valid: false, value: null };

  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return { valid: false, value: null };

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { valid: false, value: null };
  }

  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => (
    !label
    || label.length > 63
    || !/^[a-zA-Z0-9-]+$/.test(label)
    || label.startsWith('-')
    || label.endsWith('-')
  ))) {
    return { valid: false, value: null };
  }

  return { valid: true, value: `${local}@${domain.toLowerCase()}` };
}

module.exports = { normalizeOptionalEmail };
