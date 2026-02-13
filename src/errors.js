// lucidity/src/errors.js
// Structured error helpers — mirrors gro's GroError pattern.

/**
 * Normalize an unknown thrown value into an Error.
 * Handles strings, objects, nulls — the full JS throw spectrum.
 */
function asError(e) {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e.slice(0, 1024));
  if (e === null || e === undefined) return new Error('Unknown error');
  try {
    const s = String(e);
    return new Error(s.length > 1024 ? s.slice(0, 1024) + '...' : s);
  } catch {
    return new Error('Unknown error (unstringifiable)');
  }
}

module.exports = { asError };
