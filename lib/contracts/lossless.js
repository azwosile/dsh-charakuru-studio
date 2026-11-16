/**
 * Strict lossless JSON sanitizer & secret redactor for DSH Host tool & HTTP responses.
 * DSH's `snapshotJsonValue` rejects `undefined`, `NaN`, `Infinity`, `-0`, functions, and symbols.
 */

const SECRET_PATTERNS = [
  /pst-[A-Za-z0-9_-]{16,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /tsk_[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{25,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
];

export function redactSecrets(input) {
  let out = String(input ?? '');
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => '[REDACTED]');
  }
  return out;
}

export function losslessSanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'boolean') return value;
  if (t === 'string') return redactSecrets(value);
  if (t === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (t === 'bigint') {
    const asNum = Number(value);
    return Number.isSafeInteger(asNum) ? asNum : String(value);
  }
  if (t === 'function' || t === 'symbol') return null;

  if (value instanceof Error) {
    return {
      name: String(value.name || 'Error'),
      message: redactSecrets(value.message || String(value)),
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = value.map((item) => losslessSanitize(item, seen));
    seen.delete(value);
    return out;
  }

  if (t === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      out[key] = losslessSanitize(v, seen);
    }
    seen.delete(value);
    return out;
  }

  return String(value);
}

export function okEnvelope(data = {}) {
  const verdict = data.verdict || 'pass';
  return losslessSanitize({ timestamp: new Date().toISOString(), ...data, verdict, ok: verdict === 'pass' });
}

export function errorEnvelope(code, message, extra = {}) {
  return losslessSanitize({
    ok: false,
    verdict: 'fail',
    error: {
      code: String(code || 'CHARAKURU_ERROR'),
      message: redactSecrets(message || 'Unknown error'),
    },
    timestamp: new Date().toISOString(),
    ...extra,
  });
}
