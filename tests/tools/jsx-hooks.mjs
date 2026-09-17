// Module customization hooks that let `node --test` import the repository's
// React sources directly.
//
// Two things stop plain Node from loading `src/components/**/index.js`:
//
//   1. The files contain JSX, which Node cannot parse.
//   2. They import `./styles.module.css`, which Node cannot resolve.
//
// These hooks transpile JSX with @swc/core (already used by the Docusaurus
// build through @docusaurus/faster) and substitute a CSS Modules stub that
// returns each requested class name as its own value, which is close enough
// to a real CSS Modules loader for assertions about class names.
//
// Files under node_modules/ are deliberately left alone: many dependencies
// ship CommonJS with a `.js` extension, and rewriting those to ES modules
// breaks their default exports.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';

const CSS_SPECIFIER = /\.(css|scss|sass|less)$/;
const SCRIPT_URL = /\.(js|jsx|mjs)$/;

const CSS_STUB =
  'data:text/javascript,export default new Proxy({},{get:(_,key)=>' +
  '(typeof key==="string"?key:undefined)});';

export function resolve(specifier, context, nextResolve) {
  if (CSS_SPECIFIER.test(specifier)) {
    return { url: CSS_STUB, format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (
    !url.startsWith('file:') ||
    url.includes('/node_modules/') ||
    !SCRIPT_URL.test(url)
  ) {
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
