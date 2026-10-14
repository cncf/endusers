// The single-source-of-truth claim in scripts/lib/cncf-wp-api.mjs, pinned to
// the scripts/ tree it makes the claim about.
//
// That module's header states the whole reason it exists:
//
//   Centralizes the page-walking and "past the last page" 400 handling so the
//   two call sites (case studies, radar reports) can't drift out of sync on
//   retry/pagination semantics.
//
// Nothing read it. Before this file, neither `fetchAllPages` nor
// `cncf-wp-api` appeared anywhere under tests/. tests/module-imports.test.mjs
// is the closest thing, and it is explicit that its scope is whether a
// specifier *resolves* -- not which module a call site chose.
//
// What makes the gap invisible rather than merely untested is that both
// collectors already re-assert the pagination semantics themselves, against
// their own mocked fetch:
//
//   tests/collect-case-studies.test.mjs  -- x-wp-totalpages paging, the 400
//     past the last page, the 400 on page 1, the empty-batch break
//   tests/collect-radar-reports.test.mjs -- the same four
//
// Those tests pass whether the collector calls the shared helper or a copy of
// it, so the precise failure the module was created to prevent -- one call
// site growing its own loop while the other keeps importing -- leaves no
// trace. Measured at 40c6e97: replacing the import in
// scripts/collect-radar-reports.mjs with a verbatim copy of the function body
// and changing nothing else leaves `npm run test:unit:coverage:check` exiting
// 0 at 100.00% source lines and 100.00% source regions. The duplicated loop is
// driven to full coverage by the collector's own tests, and
// --require-source-files does not help: it notices a module nothing runs at
// all, not a module that one of its two callers abandoned.
//
// So this is the drift-by-omission class the repository has closed before --
// tests/audit-gate.test.mjs against SECURITY.md, tests/dev-environment.test.mjs
// against the Node major, tests/contributing-just-build-parity.test.mjs
// against the `just build` recipe. Each one pins a relationship that was
// previously stated only in prose.
//
// Scope is the scripts/ tree and nothing else. This file checks *which module
// owns the page walk*; it does not check how the walk behaves. The behaviour
// is the collectors' tests' job, and duplicating it here would recreate the
// very duplication being guarded against.
//
// The call-site rule is keyed on the API itself (`wp-json`) rather than on a
// list of filenames, so a third cncf.io WordPress collector added later is
// covered the day it lands rather than the day someone remembers this file.
//
// Every comparison below is a pure function of file text, so the fixtures at
// the bottom drive each rule red on a weakened input. A guard nobody has seen
// go red is indistinguishable from one that always passes -- the standard
// tests/e2e-coverage-gate.test.mjs sets for the coverage ratchet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsDir = join(repoRoot, 'scripts');

// The module that owns the page walk. Every rule below exempts this one file,
// because it is the one place the machinery is supposed to live.
const SHARED_MODULE = 'scripts/lib/cncf-wp-api.mjs';
const SHARED_EXPORT = 'fetchAllPages';
// The second thing the module owns: decoding the HTML entities WordPress
// leaves in `title.rendered`. Both collectors carried a byte-identical copy
// until it moved here; the rule below keeps it from growing back.
const SHARED_DECODER = 'decodeEntities';

// The call sites that exist today. Asserted as a floor, not an exact set: a
// new collector reaching the same API is caught by the `wp-json` rule without
// anyone editing this list, but losing one of these two would otherwise make
// the rules vacuous, and a vacuous guard is the thing this file is against.
const KNOWN_CALL_SITES = [
  'scripts/collect-case-studies.mjs',
  'scripts/collect-radar-reports.mjs',
];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith('.mjs')) found.push(full);
  }
  return found;
}

const scriptFiles = walk(scriptsDir)
  .map((full) => ({
    path: relative(repoRoot, full).split('\\').join('/'),
    source: readFileSync(full, 'utf8'),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

/** Files naming the cncf.io WordPress REST API, excluding the shared module. */
export function wordPressApiCallSites(files) {
  return files
    .filter(
      ({ path, source }) => path !== SHARED_MODULE && /wp-json/.test(source),
    )
    .map(({ path }) => path);
}

/** Call sites that do not import the shared export from the shared module. */
export function callSitesNotUsingSharedHelper(files) {
  const importsHelper = (source) =>
    new RegExp(
      `import\\s*\\{[^}]*\\b${SHARED_EXPORT}\\b[^}]*\\}\\s*from\\s*['"][^'"]*cncf-wp-api\\.mjs['"]`,
    ).test(source);
  return files
    .filter(
      ({ path, source }) =>
        path !== SHARED_MODULE &&
        /wp-json/.test(source) &&
        !importsHelper(source),
    )
    .map(({ path }) => path);
}

/** Files outside the shared module that declare their own page-walking helper. */
export function duplicateHelperDeclarations(files) {
  const declares = new RegExp(
    `(?:function\\s+${SHARED_EXPORT}\\b|(?:const|let|var)\\s+${SHARED_EXPORT}\\s*=)`,
  );
  return files
    .filter(
      ({ path, source }) => path !== SHARED_MODULE && declares.test(source),
    )
    .map(({ path }) => path);
}

/**
 * Call sites that build the paginated query themselves. `per_page=`/`page=`
 * against this API is the page-walking machinery the header says lives in one
 * place, so a copy at a call site is the drift.
 *
 * Deliberately narrowed to files that also name `wp-json`. `per_page`/`page`
 * is WordPress and GitHub pagination alike, and scripts/pr-queue-hygiene.mjs
 * builds exactly that query against `repos/<repo>/pulls` -- a different API,
 * a different helper, none of this module's business.
 */
export function duplicatePaginationQueries(files) {
  return files
    .filter(
      ({ path, source }) =>
        path !== SHARED_MODULE &&
        /wp-json/.test(source) &&
        /per_page=/.test(source) &&
        /\bpage=/.test(source),
    )
    .map(({ path }) => path);
}

/**
 * WordPress call sites that declare their own entity decoder. Narrowed to
 * files naming `wp-json` because scripts/lib/uri-safety.mjs legitimately
 * exports a differently-specified `decodeEntities` for scheme detection.
 */
export function duplicateEntityDecoders(files) {
  const declares = new RegExp(
    `(?:function\\s+${SHARED_DECODER}\\b|(?:const|let|var)\\s+${SHARED_DECODER}\\s*=)`,
  );
  return files
    .filter(
      ({ path, source }) =>
        path !== SHARED_MODULE &&
        /wp-json/.test(source) &&
        declares.test(source),
    )
    .map(({ path }) => path);
}

test('the shared module exports the page-walking helper', async () => {
  const module = await import(new URL(`../${SHARED_MODULE}`, import.meta.url));
  assert.equal(
    typeof module[SHARED_EXPORT],
    'function',
    `${SHARED_MODULE} must export ${SHARED_EXPORT}(); the call-site rules below are about which module owns the page walk, and they mean nothing if this one does not.`,
  );
});

test('the shared module exports the entity decoder and decodes what WordPress emits', async () => {
  const module = await import(new URL(`../${SHARED_MODULE}`, import.meta.url));
  const decode = module[SHARED_DECODER];
  assert.equal(typeof decode, 'function');
  // The forms observed in real cncf.io titles: a named ampersand, its
  // numeric twin, and the typographic apostrophe and dashes.
  assert.equal(
    decode('CI&#038;CD &amp; GitOps&#8217;s &#8211; &#8212;'),
    'CI&CD & GitOps\u2019s \u2013 \u2014',
  );
  assert.equal(decode('plain title'), 'plain title');
});

test('the known cncf.io WordPress collectors are still call sites', () => {
  const callSites = wordPressApiCallSites(scriptFiles);
  for (const expected of KNOWN_CALL_SITES) {
    assert.ok(
      callSites.includes(expected),
      `${expected} no longer names the cncf.io WordPress REST API. If it was renamed or retired, update KNOWN_CALL_SITES; if its API reference was removed, this guard just went quiet for it.`,
    );
  }
});

test('every cncf.io WordPress call site imports the shared helper', () => {
  const offenders = callSitesNotUsingSharedHelper(scriptFiles);
  assert.deepEqual(
    offenders,
    [],
    `these files reach the cncf.io WordPress REST API without importing ${SHARED_EXPORT} from ${SHARED_MODULE}:\n${offenders.join('\n')}\nThe collectors' own tests mock fetch and pass either way, so a hand-rolled loop here is invisible everywhere else.`,
  );
});

test('no script outside the shared module declares its own page-walking helper', () => {
  const offenders = duplicateHelperDeclarations(scriptFiles);
  assert.deepEqual(
    offenders,
    [],
    `${SHARED_EXPORT} is declared outside ${SHARED_MODULE} in:\n${offenders.join('\n')}`,
  );
});

test('no script outside the shared module builds the paginated query itself', () => {
  const offenders = duplicatePaginationQueries(scriptFiles);
  assert.deepEqual(
    offenders,
    [],
    `these files build the per_page/page query the shared module owns:\n${offenders.join('\n')}`,
  );
});

test('no WordPress call site declares its own entity decoder', () => {
  const offenders = duplicateEntityDecoders(scriptFiles);
  assert.deepEqual(
    offenders,
    [],
    `${SHARED_DECODER} is declared outside ${SHARED_MODULE} in:\n${offenders.join('\n')}`,
  );
});

// Fixtures. Each drives one rule red on the exact weakening it exists to
// catch, so a green run above is evidence the rule was applied rather than
// evidence it found nothing to look at.

const INLINED_LOOP = `
import { writeFileSync } from 'node:fs';
const API = 'https://www.cncf.io/wp-json/wp/v2';
async function fetchAllPages(api, path) {
  const results = [];
  let page = 1;
  for (;;) {
    const response = await fetch(\`\${api}/\${path}?per_page=100&page=\${page}\`);
    if (!response.ok) break;
    results.push(...(await response.json()));
    page += 1;
  }
  return results;
}
`;

const INLINED_DECODER = `
import { fetchAllPages } from './lib/cncf-wp-api.mjs';
const API = 'https://www.cncf.io/wp-json/wp/v2';
function decodeEntities(text) {
  return text.replace(/&amp;/g, '&');
}
`;

const USES_HELPER = `
import { fetchAllPages } from './lib/cncf-wp-api.mjs';
const API = 'https://www.cncf.io/wp-json/wp/v2';
const items = await fetchAllPages(API, 'lf_case_study');
`;

test('fixture: a collector that inlines the loop fails every call-site rule', () => {
  const files = [{ path: 'scripts/collect-made-up.mjs', source: INLINED_LOOP }];
  assert.deepEqual(wordPressApiCallSites(files), [
    'scripts/collect-made-up.mjs',
  ]);
  assert.deepEqual(callSitesNotUsingSharedHelper(files), [
    'scripts/collect-made-up.mjs',
  ]);
  assert.deepEqual(duplicateHelperDeclarations(files), [
    'scripts/collect-made-up.mjs',
  ]);
  assert.deepEqual(duplicatePaginationQueries(files), [
    'scripts/collect-made-up.mjs',
  ]);
});

test('fixture: a collector that imports the helper passes every call-site rule', () => {
  const files = [{ path: 'scripts/collect-made-up.mjs', source: USES_HELPER }];
  assert.deepEqual(wordPressApiCallSites(files), [
    'scripts/collect-made-up.mjs',
  ]);
  assert.deepEqual(callSitesNotUsingSharedHelper(files), []);
  assert.deepEqual(duplicateHelperDeclarations(files), []);
  assert.deepEqual(duplicatePaginationQueries(files), []);
});

test('fixture: the shared module itself is exempt from all four rules', () => {
  const files = [{ path: SHARED_MODULE, source: INLINED_LOOP }];
  assert.deepEqual(wordPressApiCallSites(files), []);
  assert.deepEqual(callSitesNotUsingSharedHelper(files), []);
  assert.deepEqual(duplicateHelperDeclarations(files), []);
  assert.deepEqual(duplicatePaginationQueries(files), []);
});

test('fixture: a call site with its own entity decoder is caught; uri-safety is not', () => {
  assert.deepEqual(
    duplicateEntityDecoders([
      { path: 'scripts/collect-made-up.mjs', source: INLINED_DECODER },
    ]),
    ['scripts/collect-made-up.mjs'],
  );
  assert.deepEqual(
    duplicateEntityDecoders([
      { path: 'scripts/collect-made-up.mjs', source: USES_HELPER },
      { path: SHARED_MODULE, source: INLINED_DECODER },
      {
        path: 'scripts/lib/uri-safety.mjs',
        source: `export function decodeEntities(value) { return value; }\n`,
      },
    ]),
    [],
  );
});

test('fixture: a const-assigned copy is caught, not just a function declaration', () => {
  const files = [
    {
      path: 'scripts/collect-made-up.mjs',
      source: `const fetchAllPages = async () => [];\n`,
    },
  ];
  assert.deepEqual(duplicateHelperDeclarations(files), [
    'scripts/collect-made-up.mjs',
  ]);
});

test('fixture: a script unrelated to the WordPress API is not a call site', () => {
  const files = [
    {
      path: 'scripts/validate-members.mjs',
      source: `const ALLOWED = ['cncf.io'];\n`,
    },
  ];
  assert.deepEqual(wordPressApiCallSites(files), []);
  assert.deepEqual(callSitesNotUsingSharedHelper(files), []);
});

test('fixture: pagination against a different API is not this module\u2019s drift', () => {
  // The shape scripts/pr-queue-hygiene.mjs really has: the same query
  // parameters, against the GitHub API. Claiming it as a copy of the cncf.io
  // page walk would make this guard fire on correct code.
  const files = [
    {
      path: 'scripts/pr-queue-hygiene.mjs',
      source: `const url = \`repos/\${repo}/pulls?state=open&per_page=\${perPage}&page=\${page}\`;\n`,
    },
  ];
  assert.deepEqual(wordPressApiCallSites(files), []);
  assert.deepEqual(duplicatePaginationQueries(files), []);
});
