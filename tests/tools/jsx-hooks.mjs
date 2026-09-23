// Module customization hooks that let `node --test` import the repository's
// React sources directly.
//
// Five things stop plain Node from loading `src/components/**/index.js`:
//
//   1. The files contain JSX, which Node cannot parse.
//   2. They import `./styles.module.css`, which Node cannot resolve.
//   3. They import the `@site/...` alias, which only webpack understands.
//   4. They import `@docusaurus/useBaseUrl` and `@docusaurus/Link`, which are
//      theme aliases rather than installed packages.
//   5. They import relative paths with no file extension, such as
//      `../hooks/useFocusTrap`, which webpack completes and Node does not.
//
// These hooks transpile JSX with @swc/core (already used by the Docusaurus
// build through @docusaurus/faster) and substitute a CSS Modules stub that
// returns each requested class name as its own value, which is close enough
// to a real CSS Modules loader for assertions about class names. `@site/...`
// resolves against the repository root exactly as Docusaurus configures it,
// `@docusaurus/...` resolves to the runtime stubs in ./docusaurus-stubs/, and
// the JSON those aliases point at is loaded without an import attribute so
// that the source files need no test-only changes.
//
// Files under node_modules/ are deliberately left alone: many dependencies
// ship CommonJS with a `.js` extension, and rewriting those to ES modules
// breaks their default exports.

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';

const CSS_SPECIFIER = /\.(css|scss|sass|less)$/;
const SCRIPT_URL = /\.(js|jsx|mjs)$/;
const SITE_ALIAS = '@site/';
const RELATIVE_SPECIFIER = /^\.\.?\//;
const DOCUSAURUS_ALIAS = '@docusaurus/';

const REPO_ROOT = new URL('../../', import.meta.url);
const STUB_ROOT = new URL('./docusaurus-stubs/', import.meta.url);

// Only the `@docusaurus/...` aliases that src/ actually imports are stubbed;
// anything else keeps failing loudly rather than resolving to a silent no-op.
const DOCUSAURUS_STUBS = new Set(['useBaseUrl', 'Link']);

const CSS_STUB =
  'data:text/javascript,export default new Proxy({},{get:(_,key)=>' +
  '(typeof key==="string"?key:undefined)});';

// Webpack resolves an extensionless or directory specifier by trying a list of
// extensions and then `index.<ext>`; Node's ESM resolver does neither. Source
// files written for the Docusaurus build rely on it for both alias targets
// (`@site/src/components/X` is a directory) and plain relative imports
// (`../hooks/useFocusTrap` names no extension), so both are completed here.
const RESOLVE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json'];

function isFile(url) {
  return statSync(fileURLToPath(url), { throwIfNoEntry: false })?.isFile();
}

function isDirectory(url) {
  return statSync(fileURLToPath(url), { throwIfNoEntry: false })?.isDirectory();
}

function completeTarget(target) {
  if (isFile(target)) return target.href;
  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = new URL(`${target.pathname}${extension}`, target);
    if (isFile(candidate)) return candidate.href;
  }
  if (isDirectory(target)) {
    for (const extension of RESOLVE_EXTENSIONS) {
      const candidate = new URL(`${target.pathname}/index${extension}`, target);
      if (isFile(candidate)) return candidate.href;
    }
  }
  // Nothing matched: hand back the bare target so Node reports the missing
  // module against the path the source actually asked for.
  return target.href;
}

export function resolve(specifier, context, nextResolve) {
  if (CSS_SPECIFIER.test(specifier)) {
    return { url: CSS_STUB, format: 'module', shortCircuit: true };
  }
  if (specifier.startsWith(SITE_ALIAS)) {
    const target = new URL(specifier.slice(SITE_ALIAS.length), REPO_ROOT);
    return { url: completeTarget(target), shortCircuit: true };
  }
  if (specifier.startsWith(DOCUSAURUS_ALIAS)) {
    const name = specifier.slice(DOCUSAURUS_ALIAS.length);
    if (DOCUSAURUS_STUBS.has(name)) {
      return {
        url: new URL(`${name}.mjs`, STUB_ROOT).href,
        format: 'module',
        shortCircuit: true,
      };
    }
  }
  // A relative specifier is left to Node unless it names nothing on disk, in
  // which case webpack's extension completion is applied. Completion is only
  // attempted for sources outside node_modules/, so a dependency's own
  // resolution — including its package exports — is never intercepted.
  if (
    RELATIVE_SPECIFIER.test(specifier) &&
    context.parentURL?.startsWith('file:') &&
    !context.parentURL.includes('/node_modules/')
  ) {
    const target = new URL(specifier, context.parentURL);
    if (!isFile(target)) {
      const completed = completeTarget(target);
      // completeTarget hands back the bare target when nothing matched; fall
      // through so Node reports the miss against the requested path.
      if (completed !== target.href) {
        return { url: completed, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || url.includes('/node_modules/')) {
    return nextLoad(url, context);
  }

  // Docusaurus lets a component `import data from '@site/data/x.json'` with no
  // import attribute; Node requires `with { type: 'json' }`. Re-export the
  // parsed data as a module so the source stays unchanged.
  if (url.endsWith('.json')) {
    if (context.importAttributes?.type === 'json') {
      return nextLoad(url, context);
    }
    const data = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      source: `export default ${data};`,
      shortCircuit: true,
    };
  }

  if (!SCRIPT_URL.test(url)) {
    return nextLoad(url, context);
  }

  const filename = fileURLToPath(url);
  const source = readFileSync(filename, 'utf8');
  if (!source.includes('<')) {
    return nextLoad(url, context);
  }

  const { code } = transformSync(source, {
    filename,
    sourceMaps: 'inline',
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'esnext',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'es6' },
  });

  return { format: 'module', source: code, shortCircuit: true };
}
