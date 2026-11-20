/**
 * URL state serialization (§5.4 Zero-Backend Persistence).
 *
 * A full quantum state — quantum numbers, complex phasors, render mode, camera
 * orientation, potential presets — is packed into
 * a compact query string so a teacher can paste a link into slides and get the
 * exact same physics back. No backend, no database: the URL *is* the save file.
 *
 * Encoding: `?sim=<slug>&p=<key>:<value>,<key>:<value>` where number arrays use
 * `_` separators and everything is URI-safe (`, : _ . -` plus alphanumerics).
 */

import type { SimParamValue, SimParams } from '@/simulations/types';

const KEY_VALUE = ':';
const PAIR = ',';
const ARRAY = '_';

function quantise(v: number): number {
  if (!Number.isFinite(v)) return 0;
  /* Twelve significant digits keeps every hand-written value exact — an electron
   * mass of 9.1093837015e-31 kg or a 1.2e-4 s timestep survives the round-trip —
   * while still trimming float noise (0.1 + 0.2 → 0.3). Number() drops the
   * trailing zeros, so a slider step of 0.5 stays a two-character token. */
  return v === 0 ? 0 : Number(v.toPrecision(12));
}

function encodeValue(v: SimParamValue): string {
  if (typeof v === 'number') return String(quantise(v));
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) return v.map((n) => String(quantise(n))).join(ARRAY);
  return encodeURIComponent(v);
}

function decodeValue(raw: string, template?: SimParamValue): SimParamValue {
  if (template === undefined) {
    if (raw === '1') return 1;
    if (raw === '0') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : safeDecode(raw);
  }
  if (typeof template === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : template;
  }
  if (typeof template === 'boolean') return raw === '1';
  if (Array.isArray(template)) {
    if (raw === '') return [];
    const parts = raw.split(ARRAY);
    const out: number[] = [];
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n)) return template; // all-or-nothing: never desync parallel arrays
      out.push(n);
    }
    return out;
  }
  return safeDecode(raw);
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Serialize params into the `p=` payload (keys sorted for determinism). */
export function encodeParams(params: SimParams): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => `${encodeURIComponent(k)}${KEY_VALUE}${encodeValue(params[k])}`)
    .join(PAIR);
}

/**
 * Rebuild params. Unknown keys are dropped, missing keys keep the template value,
 * so an old link still hydrates correctly after a control is added.
 */
export function decodeParams(payload: string | null, template: SimParams): SimParams {
  const out: SimParams = { ...template };
  if (!payload) return out;
  for (const pair of payload.split(PAIR)) {
    const idx = pair.indexOf(KEY_VALUE);
    if (idx <= 0) continue;
    const key = safeDecode(pair.slice(0, idx));
    if (!(key in template)) continue;
    out[key] = decodeValue(pair.slice(idx + 1), template[key]);
  }
  return out;
}

export interface ShareTarget {
  slug: string;
  params: SimParams;
  template: SimParams;
  pathname?: string;
  demo?: string | null;
}

/** Build the canonical shareable path for a simulation state. */
export function buildShareUrl({
  slug,
  params,
  template,
  pathname = '/',
  demo = null,
}: ShareTarget): string {
  const qs = new URLSearchParams();
  qs.set('sim', slug);
  const p = encodeParams(params);
  if (p && p !== encodeParams(template)) qs.set('p', p);
  if (demo) qs.set('demo', demo);
  return `${pathname}?${qs.toString()}`;
}

/** Read `sim` + `p` out of a search string. */
export function readShare(search: string): { slug: string | null; payload: string | null; demo: string | null } {
  const qs = new URLSearchParams(search);
  return {
    slug: qs.get('sim'),
    payload: qs.get('p'),
    demo: qs.get('demo'),
  };
}
