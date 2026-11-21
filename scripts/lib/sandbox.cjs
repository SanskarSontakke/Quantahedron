/**
 * Headless execution sandbox for the verification scripts.
 *
 * The simulations are TypeScript + JSX modules that normally only run inside
 * Next.js. To exercise their pure logic (telemetry, math drawers, demo scripts,
 * URL codec) in plain Node, this helper transpiles `src/**\/*.ts(x)` to
 * CommonJS in a temp directory, then patches the module resolver so that:
 *
 *   - `@/…` path aliases point at the transpiled tree,
 *   - `next/navigation` and `next/dynamic` resolve to inert stubs,
 *   - CSS imports and `new Worker(new URL(…))` specifiers resolve to stubs,
 *   - `import.meta.url` (illegal in CJS) is replaced with a file URL literal.
 *
 * Nothing here touches the repo; the build output lives in os.tmpdir().
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'src');
const OUT = path.join(os.tmpdir(), 'quantahedron-cjs');
const STUBS = path.join(OUT, '.stubs');
const repoRequire = Module.createRequire(path.join(REPO, 'noop.js'));
const ts = repoRequire('typescript');
const katex = repoRequire('katex');

/* ---------- 1. transpile the whole tree ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'package.json'), '{"type":"commonjs"}\n');
try {
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(OUT, 'node_modules'), 'dir');
} catch {}
fs.mkdirSync(STUBS, { recursive: true });
fs.writeFileSync(
  path.join(STUBS, 'navigation.js'),
  `'use strict';
module.exports = {
  __esModule: true,
  useRouter: () => ({ push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
  usePathname: () => '/sim/orbitalis-3d',
  useSearchParams: () => new URLSearchParams(),
};
`,
);
fs.writeFileSync(
  STUBS + '/dynamic.js',
  `'use strict';
module.exports = { __esModule: true, default: () => function Stub(){ return null; } };
`,
);
fs.writeFileSync(STUBS + '/css.js', 'module.exports = {};\n');

let built = 0;
const build = (file) => {
  const rel = path.relative(SRC, file).replace(/\.tsx?$/, '.js');
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  /* the CJS harness cannot carry import.meta — stub the worker URL */
  const src = fs.readFileSync(file, 'utf8').replace(/import\.meta\.url/g, JSON.stringify('file://' + path.join(OUT, 'stub.js')));
  const out = ts.transpileModule(src, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowJs: true,
      isolatedModules: true,
      importHelpers: false,
    },
  });
  fs.writeFileSync(dest, out.outputText);
  built++;
};
(() => {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) build(p);
    }
  };
  walk(SRC);
})();

/* ---------- 2. resolution ---------- */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'next/navigation') return path.join(STUBS, 'navigation.js');
  if (request === 'next/dynamic') return path.join(STUBS, 'dynamic.js');
  if (request.endsWith('.css') || /\.worker(\.ts|\.js)?$/.test(request)) return path.join(STUBS, 'css.js');
  if (request.startsWith('@/')) {
    const base = path.join(OUT, request.slice(2));
    for (const c of [base + '.js', path.join(base, 'index.js')]) if (fs.existsSync(c)) return c;
  }
  return origResolve.call(this, request, parent, isMain, options);
};

const registry = repoRequire(path.join(OUT, 'simulations/registry.js'));

module.exports = { REPO, SRC, OUT, STUBS, repoRequire, registry, katex, ts, built };
