import crypto from 'node:crypto';

export function stableSortValue(value) {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stableSortValue(value[k])]));
  }
  return value;
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(stableSortValue(value), null, space);
}

export function sha256(input) {
  return crypto.createHash('sha256').update(typeof input === 'string' ? input : Buffer.from(input)).digest('hex');
}

export function asArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (payload?.data && Array.isArray(payload.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') {
    for (const key of keys) if (Array.isArray(payload.data?.[key])) return payload.data[key];
  }
  return [];
}

export function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export function truncate(value, max = 12000) {
  const s = typeof value === 'string' ? value : stableStringify(value);
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

export function nowIso() { return new Date().toISOString(); }
