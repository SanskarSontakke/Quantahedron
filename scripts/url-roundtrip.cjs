/**
 * URL-as-source-of-truth round-trip across every registered simulation (CI gate).
 *
 * A permalink is the only way a learner can bring a state back to a tutor, so the
 * codec must be lossless and total: encode -> decode reproduces the state exactly
 * (numbers to 12 significant digits, arrays element-wise, strings verbatim), the
 * serialised form is canonical (key-sorted, so identical states give identical
 * URLs), it never contains a raw `&`, `=` or space, defaults produce no `p=`
 * payload at all, and the `demo=` flag survives a share/reload cycle.
 *
 * Malformed payloads ('time:NaN', 'ampsN:1_2_x', '%35%35', a 90-character run of
 * commas, null) must fall back to the template rather than throw or invent a
 * non-finite number.
 *
 * Exits non-zero on any failure.
 */
'use strict';
const path = require('path');
const { repoRequire, registry, OUT } = require('./lib/sandbox.cjs');
const { encodeParams, decodeParams, buildShareUrl, readShare } = repoRequire(path.join(OUT, 'store/urlState.js'));

const fails = [];
let cases = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r3 = (v) => (typeof v === 'number' ? (v === 0 ? 0 : Number(v.toPrecision(12))) : v);
const norm = (p) => {
  const o = {};
  for (const k of Object.keys(p)) o[k] = Array.isArray(p[k]) ? p[k].map(r3) : r3(p[k]);
  return o;
};

for (const e of registry.SIM_REGISTRY) {
  let mod;
  try {
    const l = repoRequire(path.join(OUT, 'simulations', e.slug, 'index.js'));
    mod = l.default || l;
  } catch {
    continue;
  }
  const def = mod.defaultParams;
  if (!eq(encodeParams(def), encodeParams(e.defaultParams))) fails.push(`${e.slug} registry defaults != module defaults (serialised)`);

  const stress = Object.assign({}, def);
  for (const c of mod.controls || []) {
    if (!(c.key in def)) continue;
    const v = def[c.key];
    if (typeof v === 'number') stress[c.key] = -Math.abs(v) - 0.123456789;
    else if (typeof v === 'boolean') stress[c.key] = !v;
    else if (Array.isArray(v)) stress[c.key] = v.map((x, i) => (i % 2 ? -x - 0.0005 : x + 12.3456));
    else if (typeof v === 'string') stress[c.key] = String(v) + '-a b&c=d#e';
  }
  const sets = [['defaults', def], ['stress', stress], ['scrambled', Object.fromEntries(Object.keys(stress).reverse().map((k) => [k, stress[k]]))]];

  for (const [tag, p] of sets) {
    cases++;
    const enc = encodeParams(p);
    const back = decodeParams(enc, def);
    const want = norm(p);
    for (const k of Object.keys(want)) if (!eq(back[k], want[k])) fails.push(`${e.slug}/${tag} encode→decode ${k}: ${JSON.stringify(want[k])} → ${JSON.stringify(back[k])}`);
    if (Object.keys(back).length !== Object.keys(want).length) fails.push(`${e.slug}/${tag} key count ${Object.keys(back).length} vs ${Object.keys(want).length}`);
    if (/[&?=]/.test(enc)) fails.push(`${e.slug}/${tag} payload has a raw query delimiter: ${enc.slice(0, 90)}`);
    if (/ / .test(enc)) fails.push(`${e.slug}/${tag} payload has a raw space`);
    /* canonical: sorted keys, so the same state always yields the same URL */
    if (enc !== encodeParams(Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]])))) fails.push(`${e.slug}/${tag} not key-sorted`);

    const rel = buildShareUrl({ slug: e.slug, params: p, template: def, pathname: '/sim/x' });
    const read = readShare(new URL('https://q.example' + rel).search);
    if (read.slug !== e.slug) fails.push(`${e.slug}/${tag} share slug → ${read.slug}`);
    const rt = decodeParams(read.payload, def);
    for (const k of Object.keys(want)) if (!eq(rt[k], want[k])) fails.push(`${e.slug}/${tag} share lost ${k}=${JSON.stringify(want[k])} → ${JSON.stringify(rt[k])}`);
    const dflt = buildShareUrl({ slug: e.slug, params: def, template: def, pathname: '/sim/x' });
    if (dflt.includes('&p=')) fails.push(`${e.slug} default state still writes a p= payload`);
    const durl = buildShareUrl({ slug: e.slug, params: p, template: def, demo: 'kinetic-tour', pathname: '/sim/x' });
    if (readShare(new URL('https://q.example' + durl).search).demo !== 'kinetic-tour') fails.push(`${e.slug}/${tag} demo flag lost`);
  }

  for (const bad of ['', null, 'nokey', 'x:1', 'x:', '::', 'a:_', 'ampsN:1_2_x', '%%%%', 'time:NaN', 'time:1e999', ',,,'.repeat(30)]) {
    cases++;
    try {
      const r = decodeParams(bad, def);
      for (const k of Object.keys(def)) {
        const v = r[k];
        const numBad = typeof v === 'number' && !Number.isFinite(v);
        const changed = !eq(v, def[k]);
        const truncated = Array.isArray(def[k]) && Array.isArray(v) && JSON.stringify(def[k].slice(0, v.length)) === JSON.stringify(v);
        if (changed && !numBad && !truncated && k !== 'time' && k !== 'playing') fails.push(`${e.slug} malformed ${JSON.stringify(bad)} → ${k}=${JSON.stringify(v)}`);
        if (numBad) fails.push(`${e.slug} malformed ${JSON.stringify(bad)} → ${k} non-finite ${v}`);
      }
    } catch (err) {
      fails.push(`${e.slug} malformed ${JSON.stringify(bad)} THREW ${err.message}`);
    }
  }
}
console.log(`url round-trip: ${cases} cases · ${fails.length} failures`);
for (const f of [...new Set(fails)].slice(0, 30)) console.log('  - ' + f);
process.exitCode = fails.length ? 1 : 0;
