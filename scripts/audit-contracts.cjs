/**
 * Runtime contract audit for the Quantahedron simulation registry (CI gate).
 *
 * The stage shell is contract-driven, so a simulation can be individually
 * type-correct and still be broken in the browser: a control that targets a
 * param nobody reads, a slider step that can never reach its own default, a
 * telemetry cell that prints "NaN", a TeX span KaTeX refuses to parse, a demo
 * keyframe that sets an unknown key. Only executing the modules catches those,
 * so this script loads the real registry through the CJS sandbox and drives
 * every module across a wide parameter sweep.
 *
 * Checks per simulation:
 *   registry meta  == module meta (13 fields, byte-identical)
 *   registry defaultParams == module defaultParams
 *   controls: unique keys, legal `kind`, complete select options, slider
 *            min/max/step coherence, default inside range and on the step grid,
 *            toggle defaults boolean, `visibleIf` predicates total
 *   extraTabs / demos: id collisions, glyph width, keyframe ordering, keyframe
 *            param keys and durations, monotone timeline
 *   telemetry / math / describe: executed at defaults, at each control's
 *            min/mid/max, with every toggle flipped, with every select option,
 *            and at t = 4096.75 s with the clock running — then scanned for
 *            NaN / Infinity / undefined / [object Object] / control characters
 *   math drawer: every TeX span compiled with KaTeX (throwOnError)
 *
 * Exits non-zero when anything hard fails.
 */
'use strict';
const path = require('path');
const { repoRequire, registry, OUT, katex, built } = require('./lib/sandbox.cjs');

const JUNK = /(\bNaN\b|\bInfinity\b|\bundefined\b|\[object Object\]|[\x00-\x08\x0b\x0c\x0e-\x1f])/;
const scan = (v, where, lines, seen = new Set()) => {
  if (v == null || seen.has(v)) return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) lines.push(`NON-FINITE ${where}=${v}`);
    return;
  }
  if (typeof v === 'string') {
    if (JUNK.test(v)) lines.push(`JUNK ${where}: "${v.slice(0, 90)}"`);
    return;
  }
  if (Array.isArray(v)) {
    seen.add(v);
    v.forEach((x, i) => scan(x, `${where}[${i}]`, lines, seen));
    return;
  }
  if (typeof v === 'object') {
    seen.add(v);
    for (const k of Object.keys(v)) scan(v[k], `${where}.${k}`, lines, seen);
  }
};
let texTotal = 0;
const checkTex = (tex, where, lines) => {
  texTotal++;
  const lit = String(tex).replace(/\$\{[^}]*\}/g, '1.0');
  try {
    katex.renderToString(lit, { throwOnError: true, displayMode: false, strict: 'ignore', trust: false });
  } catch (e) {
    lines.push(`TEX-ERR ${where}: ${String(e.message).split('\n')[0].slice(0, 110)}`);
  }
};
const walkTex = (node, where, lines) => {
  if (node == null) return;
  if (Array.isArray(node)) return node.forEach((x, i) => walkTex(x, `${where}[${i}]`, lines));
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) walkTex(node[k], `${where}.${k}`, lines);
    return;
  }
  if (typeof node === 'string') {
    for (const mm of node.matchAll(/\$([^$]+)\$/g)) checkTex(mm[1], `${where} (inline)`, lines);
  }
};
const firstControl = (mod, g) => {
  const c = (mod.controls || []).find((x) => x.group === g);
  return c ? c.key : '?';
};

const problems = [];
for (const e of registry.SIM_REGISTRY) {
  const lines = [];
  let mod;
  try {
    const loaded = repoRequire(path.join(OUT, 'simulations', e.slug, 'index.js'));
    mod = loaded.default || loaded;
  } catch (err) {
    console.log(`\n[${e.slug}] LOAD FAILED`);
    console.log('   ' + String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err).slice(0, 320));
    problems.push(`${e.slug}: module does not load`);
    continue;
  }
  const m = mod.meta || {};
  const rm = e.meta || {};
  for (const k of ['slug', 'name', 'tagline', 'track', 'difficulty', 'exploreMinutes', 'engine', 'gpu', 'description', 'accent', 'order', 'tags']) {
    const a = JSON.stringify(rm[k]);
    const b = JSON.stringify(m[k]);
    if (a !== b) lines.push(`META-DIFF ${k} reg=${a} mod=${b}`);
  }
  if (JSON.stringify(e.defaultParams) !== JSON.stringify(mod.defaultParams))
    lines.push(`DEFAULTS-DIFF registry(${Object.keys(e.defaultParams || {}).length}) vs module(${Object.keys(mod.defaultParams || {}).length})`);

  const def = mod.defaultParams || {};
  const variantsLater = [Object.assign({}, def)];
  const seenKeys = new Set();
  for (const c of mod.controls || []) {
    if (!(c.key in def)) lines.push(`UNKNOWN-CTL ${c.key} "${c.label}"`);
    if (seenKeys.has(c.key)) lines.push(`DUP-CTL ${c.key}`);
    seenKeys.add(c.key);
    if (!['slider', 'toggle', 'select'].includes(c.kind)) lines.push(`BAD-KIND ${c.key} kind=${c.kind}`);
    const v = def[c.key];
    if (c.kind === 'select') {
      if (!Array.isArray(c.options) || !c.options.length) lines.push(`SELECT-NO-OPTIONS ${c.key}`);
      else {
        const vals = c.options.map((o) => o.value);
        if (new Set(vals).size !== vals.length) lines.push(`SELECT-DUP-OPTION ${c.key}`);
        if (!vals.map(String).includes(String(v))) lines.push(`SELECT-DEFAULT ${c.key}=${JSON.stringify(v)} not in [${vals.join(', ')}]`);
        if (c.options.some((o) => !o.label)) lines.push(`SELECT-NO-LABEL ${c.key}`);
      }
    }
    if (c.kind === 'toggle' && typeof v !== 'boolean') lines.push(`TOGGLE-TYPE ${c.key} = ${JSON.stringify(v)} (not boolean)`);
    if (c.kind === 'slider') {
      if (typeof v !== 'number') lines.push(`SLIDER-TYPE ${c.key} = ${JSON.stringify(v)} (not number)`);
      if (!(Number.isFinite(c.min) && Number.isFinite(c.max)) || c.min >= c.max) lines.push(`BAD-RANGE ${c.key} [${c.min},${c.max}]`);
      if (!(c.step > 0)) lines.push(`BAD-STEP ${c.key} step=${c.step}`);
      else if (typeof v === 'number') {
        if (v < c.min - 1e-9 || v > c.max + 1e-9) lines.push(`OUT-OF-RANGE ${c.key}=${v} ∉ [${c.min},${c.max}]`);
        else if (Math.abs((v - c.min) / c.step - Math.round((v - c.min) / c.step)) > 1e-6)
          lines.push(`OFF-STEP ${c.key}=${v} (min ${c.min}, step ${c.step})`);
      }
      if (c.log && (c.min <= 0 || c.max <= 0)) lines.push(`LOG-RANGE ${c.key} [${c.min},${c.max}]`);
    }
    if (typeof c.format === 'function' && v !== undefined) {
      try {
        const probe = c.kind === 'slider' ? (typeof v === 'number' ? v : c.min) : String(v);
        const out = c.format(probe);
        if (JUNK.test(String(out))) lines.push(`FORMAT-JUNK ${c.key} → ${out}`);
      } catch (err) {
        lines.push(`FORMAT THROWS ${c.key}: ${err.message}`);
      }
    }
    if (typeof c.visibleIf === 'function') {
      try {
        if (typeof c.visibleIf(def) !== 'boolean') lines.push(`VISIBLEIF-NONBOOL ${c.key}`);
        for (const extra of variantsLater) { const r = c.visibleIf(extra); if (typeof r !== 'boolean') lines.push(`VISIBLEIF-NONBOOL ${c.key} → ${r}`); }
      } catch (err) {
        lines.push(`VISIBLEIF THROWS ${c.key}: ${err.message}`);
      }
    }
    scan(c.label, `ctl ${c.key}.label`, lines);
    scan(c.help || '', `ctl ${c.key}.help`, lines);
  }
  const groups = new Set((mod.controls || []).map((c) => c.group));
  for (const g of groups) if (!['state', 'visuals', 'plots', 'fields'].includes(g)) lines.push(`BAD-GROUP "${g}" (${firstControl(mod, g)})`);
  for (const t of mod.extraTabs || []) {
    if (groups.has(t.id)) lines.push(`TAB-COLLISION "${t.id}" is both a control group and an extraTab`);
    if (!t.Component) lines.push(`TAB-NO-COMPONENT "${t.id}"`);
    if (!t.glyph || t.glyph.length > 2) lines.push(`TAB-GLYPH "${t.id}" = "${t.glyph}"`);
  }
  const demoIds = new Set();
  for (const dm of mod.demos || []) {
    if (demoIds.has(dm.id)) lines.push(`DUP-DEMO ${dm.id}`);
    demoIds.add(dm.id);
    if (!(dm.durationSec > 0)) lines.push(`DEMO ${dm.id}: durationSec=${dm.durationSec}`);
    let last = -1;
    for (const kf of dm.keyframes || []) {
      if (kf.at < last) lines.push(`DEMO ${dm.id}: keyframes out of order at ${kf.at}`);
      last = kf.at;
      if (kf.at > dm.durationSec) lines.push(`DEMO ${dm.id}: keyframe at=${kf.at} > duration ${dm.durationSec}`);
      for (const k of Object.keys(kf.params || {})) {
        if (!(k in def)) lines.push(`DEMO ${dm.id}:${k} unknown key`);
        else if (typeof def[k] === 'number' && !Number.isFinite(Number(kf.params[k]))) lines.push(`DEMO ${dm.id}:${k} = ${kf.params[k]}`);
      }
    }
    scan(dm.summary, `demo ${dm.id}.summary`, lines);
    for (const kf of dm.keyframes || []) scan(kf.caption || '', `demo ${dm.id}@${kf.at}`, lines);
  }
  if (!mod.Canvas) lines.push('NO-CANVAS');

  for (const c of mod.controls || []) {
    if (c.kind === 'slider') {
      variantsLater.push(Object.assign({}, def, { [c.key]: c.min }));
      variantsLater.push(Object.assign({}, def, { [c.key]: c.max }));
      variantsLater.push(Object.assign({}, def, { [c.key]: (c.min + c.max) / 2 }));
      if (c.min <= 0 && c.max >= 0) variantsLater.push(Object.assign({}, def, { [c.key]: 0 }));
    } else if (c.kind === 'toggle') variantsLater.push(Object.assign({}, def, { [c.key]: !def[c.key] }));
    else if (c.kind === 'select' && c.options) for (const o of c.options) variantsLater.push(Object.assign({}, def, { [c.key]: o.value }));
  }
  variantsLater.push(Object.assign({}, def, { time: 4096.75, playing: true }));
  const variants = variantsLater;

  if (mod.telemetry) {
    let n = 0;
    let threw = null;
    for (const p of variants) {
      try {
        const items = mod.telemetry(p);
        n = Math.max(n, items.length);
        for (const it of items) {
          scan(it.value, `telemetry "${it.label}"`, lines);
          scan(it.hint || '', `telemetry "${it.label}".hint`, lines);
        }
      } catch (err) {
        threw = String(err && err.message ? err.message : err).split('\n')[0];
        break;
      }
    }
    lines.push(threw ? `TELEMETRY THROWS ${threw}` : `telemetry ${n} items ok`);
  } else lines.push('NO-TELEMETRY');

  if (mod.math) {
    let threw = null;
    let nsteps = 0;
    for (const p of variants) {
      try {
        const sp = mod.math(p);
        nsteps = Math.max(nsteps, (sp.derivation || []).reduce((a, d) => a + d.steps.length, 0));
        if (!(sp.formula || []).length) lines.push('MATH no formula');
        if (!(sp.readout || []).length) lines.push('MATH no readout');
        if (!sp.phaseLegend) lines.push('MATH no phaseLegend');
        if (!(sp.intuition || '').length) lines.push('MATH no intuition');
        if (!(sp.challenge || []).length) lines.push('MATH no challenge');
        for (const f of sp.formula || []) {
          checkTex(f.tex, 'math.formula', lines);
          scan(f.note || '', 'math.formula.note', lines);
        }
        for (const r of sp.readout || []) scan(r.value, `math.readout "${r.label}"`, lines);
        for (const d of sp.derivation || []) {
          for (const s of d.steps) {
            scan(s.text, `math.step "${d.title}"`, lines);
            scan(s.note || '', `math.note "${d.title}"`, lines);
            for (const b of s.math || []) checkTex(b.tex, `math.step "${d.title}"`, lines);
          }
        }
        for (const ch of sp.challenge || []) {
          scan(ch.question, 'challenge.q', lines);
          scan(ch.hint, 'challenge.hint', lines);
          scan(ch.answer, 'challenge.answer', lines);
          if (ch.paramKey && !(ch.paramKey in def)) lines.push(`CHALLENGE paramKey "${ch.paramKey}" unknown`);
        }
        walkTex(sp.intuition, 'math.intuition', lines);
        walkTex(sp.phaseLegend, 'math.phaseLegend', lines);
      } catch (err) {
        threw = String(err && err.message ? err.message : err).split('\n')[0];
        break;
      }
    }
    lines.push(threw ? `MATH THROWS ${threw}` : `math ${nsteps} derivation steps ok`);
  } else lines.push('NO-MATH');

  if (mod.describe) {
    let threw = null;
    for (const p of variants) {
      try {
        scan(mod.describe(p), 'describe', lines);
      } catch (err) {
        threw = String(err && err.message ? err.message : err).split('\n')[0];
        break;
      }
    }
    if (threw) lines.push(`DESCRIBE THROWS ${threw}`);
  }

  const hard = lines.filter((l) => !/^(telemetry|math) /.test(l));
  console.log(`\n[${m.name || e.slug}] ctl=${(mod.controls || []).length} groups=${[...groups].join(',')} demos=${(mod.demos || []).length} tabs=${(mod.extraTabs || []).map((t) => t.id).join('/') || '-'}`);
  for (const l of lines) console.log('   ' + l);
  problems.push(...hard.map((l) => `${m.name || e.slug}: ${l}`));
}

console.log(`\ntranspiled ${built} files · tex spans ${texTotal} · problems ${problems.length}`);
for (const p of problems) console.log('  - ' + p);
process.exitCode = problems.length ? 1 : 0;
