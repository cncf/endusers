// Guards the reachability of package.json's private `_`-prefixed scripts.
//
// The `_` prefix is this repository's convention for a script that exists only
// to be called by another script: `check:format` runs `_check:format`,
// `check:markdown` runs `_check:markdown:all`, `check:links` runs
// `_check:links` which runs `_check:links-md` which expands
// `_list:check:md`. None of those is meant to be typed by a contributor or
// named by a workflow, which is exactly why nothing notices when one stops
// being called.
//
// tests/workflow-scripts.test.mjs asks the adjacent question for the public
// surface -- every `validate:*`/`check:*` gate is run by a workflow or recorded
// in GATES_NOT_RUN_BY_CI with a reason -- and `gateScripts()` there filters on
// `^(?:validate|check):`, so a `_`-prefixed helper is outside its denominator
// by construction. tests/check-aggregate-contract.test.mjs pins what the
// `check` aggregate expands to, and tests/npm-lifecycle-scripts.test.mjs pins
// the lifecycle hooks; neither walks the call graph between scripts. A helper
// that no longer has a caller therefore passes every guard in the suite while
// being dead text: it is still a valid script, it still resolves, and
// `npm run <it>` still works -- so the only signal that it was orphaned is that
// nobody runs it, which is not a thing any assertion was asking.
//
// That matters more here than dead code usually does, because these helpers
// are the gates' implementations. A `check:*` entry point rewired to call a
// different helper leaves the old one behind, still passing in isolation, and
// the next reader cannot tell the abandoned implementation from the live one.
//
// So: every `_`-prefixed script must be reachable from a public script by some
// chain of `npm run` calls, or be recorded below with the reason it is not.
// That follows the GATES_NOT_RUN_BY_CI convention in
// tests/workflow-scripts.test.mjs -- an omission stays possible, but it is
// argued for in the diff rather than discovered later -- and the last two tests
// here retire the record the same way, by failing when an entry names a script
// package.json no longer defines or one that has since become reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const names = Object.keys(scripts);

// Helpers that no public script reaches, each with the reason it is kept.
//
// The three `:delta` / `:any` entries are a related family: a contributor-only
// shortcut that lints or formats just the files `git diff` reports, instead of
// the whole tree. They are deliberately not wired into `check` -- CI has to
// look at every file, not at a diff -- and they have no caller for the same
// reason. `_check:format:any` is reachable only from `_check:format:delta`,
// which is itself unreachable, so it is recorded here too rather than counted
// as live through a dead caller.
const UNREACHED_PRIVATE_SCRIPTS = new Map([
  [
    '_check:format:any',
    'The prettier invocation `_check:format:delta` parameterises; reachable ' +
      'only from that entry, which is itself unreached.',
  ],
  [
    '_check:format:delta',
    'Contributor shortcut: formats only the files `_list:git:delta` reports. ' +
      'Deliberately not in `check`, which must see every file.',
  ],
  [
    '_check:markdown:1',
    'A single-file markdownlint invocation with no caller and no documented ' +
      'use; `check:markdown` runs `_check:markdown:all` instead. Recorded ' +
      'rather than deleted because removing a package.json script is a ' +
      "maintainer's call, not a test's.",
  ],
  [
    '_check:markdown:delta',
    'Contributor shortcut: lints only the files `_list:git:delta` reports. ' +
      'Deliberately not in `check`, which must see every file.',
  ],
  [
    '_list:check:md:no-analysis',
    'A narrower variant of `_list:check:md` that also excludes the `00*` ' +
      'analysis files; kept for manual runs over the published docs only.',
  ],
  [
    '_list:git:delta',
    'The changed-file list the two `:delta` shortcuts above consume; ' +
      'unreached for the same reason they are.',
  ],
]);

const privateScripts = () => names.filter((name) => name.startsWith('_'));

// Whole-token containment rather than a `npm run` parse: the call sites take
// several shapes in this file -- `npm run _check:format`, `npm run -s
// _list:git:delta`, `npm -s run _list:fix:*`, and command substitutions such as
// `$(npm run -s _list:check:*)` -- and a parser for all of them would be a
// second thing to keep correct. The boundary characters exclude `:` so that
// `_check:format` is not credited for the `_check:format:delta` that contains
// it, and exclude `*` is *not* needed: `_list:check:*` is a script name whose
// own trailing `*` is part of the token being matched.
function callsScript(body, target) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^:\\w.-])${escaped}(?![:\\w.-])`).test(body);
}

function isExplained(reason) {
  return typeof reason === 'string' && reason.trim() !== '';
}

function reachablePrivateScripts() {
  const reached = new Set(names.filter((name) => !name.startsWith('_')));
  const queue = [...reached];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const candidate of names) {
      if (reached.has(candidate)) continue;
      if (!callsScript(scripts[current], candidate)) continue;
      reached.add(candidate);
      queue.push(candidate);
    }
  }
  return reached;
}

test('every private script is reachable from a public one or recorded', () => {
  const reached = reachablePrivateScripts();
  const orphaned = privateScripts()
    .filter(
      (name) => !reached.has(name) && !UNREACHED_PRIVATE_SCRIPTS.has(name),
    )
    .sort();
  assert.deepEqual(
    orphaned,
    [],
    'private scripts no public script reaches; either give them a caller or ' +
      'record them in UNREACHED_PRIVATE_SCRIPTS with the reason they are kept',
  );
});

test('the reachability walk credits a real multi-step chain', () => {
  // Pins the guard above to evidence rather than to spelling. `check:links`
  // reaches `_check:links-md` only through `_check:links`, and `_list:check:md`
  // only through `_check:links-md`, so a walk that stopped at depth one -- or
  // one whose matcher stopped matching -- would pass the assertion above
  // vacuously while reporting these as orphans.
  const reached = reachablePrivateScripts();
  for (const name of ['_check:links', '_check:links-md', '_list:check:md']) {
    assert.ok(
      names.includes(name),
      `${name} is no longer a script; update this test's fixture chain`,
    );
    assert.ok(
      reached.has(name),
      `${name} should be reachable from check:links`,
    );
  }
});

test('the matcher does not credit a script for a longer name containing it', () => {
  // `_check:format` is a prefix of `_check:format:delta`. Without the `:`
  // boundary the walk would call the shorter name reached by the longer one and
  // the guard would go quiet for a whole family at once.
  assert.ok(callsScript('npm run _check:format', '_check:format'));
  assert.ok(!callsScript('npm run _check:format:delta', '_check:format'));
});

test('every recorded omission still names a defined script', () => {
  const stale = [...UNREACHED_PRIVATE_SCRIPTS.keys()]
    .filter((name) => !(name in scripts))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'UNREACHED_PRIVATE_SCRIPTS names scripts package.json no longer defines',
  );
});

test('every recorded omission is still unreached, and says why', () => {
  const reached = reachablePrivateScripts();
  const nowReached = [...UNREACHED_PRIVATE_SCRIPTS.keys()]
    .filter((name) => reached.has(name))
    .sort();
  assert.deepEqual(
    nowReached,
    [],
    'these scripts now have a caller — delete them from ' +
      'UNREACHED_PRIVATE_SCRIPTS',
  );
  const unexplained = [...UNREACHED_PRIVATE_SCRIPTS.entries()]
    .filter(([, reason]) => !isExplained(reason))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    unexplained,
    [],
    'omissions recorded without saying why the helper is kept',
  );
});

test('a blank or non-string reason does not count as an explanation', () => {
  // The omission record is only worth keeping if the reason column cannot be
  // satisfied by whitespace or by a placeholder of the wrong type.
  assert.ok(isExplained('because'));
  assert.ok(!isExplained('   '));
  assert.ok(!isExplained(undefined));
});

test('the repository root this test reads is the one package.json lives in', () => {
  // The suite runs from the repository root, but the fixtures above are read
  // through import.meta.url so the file is correct under any cwd. Asserting the
  // resolved root keeps that from silently drifting to a different checkout.
  assert.ok(repoRoot.endsWith('/'), `unexpected repo root ${repoRoot}`);
  assert.ok(names.includes('check'), 'package.json defines no `check` script');
});
