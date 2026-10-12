// The `check` aggregate and the gates it is supposed to contain.
//
// `npm run check` does not name its members. It is
// `npm run seq -- $(npm run -s _list:check:*)`, and `_list:check:*` selects
// them by grepping `npm run`'s own listing with `^\s*check:[^:]+$`
// (`package.json`). So membership is decided by a regular expression over
// script names, at runtime, in a subshell -- and the one thing that regex
// cannot match is a name with a second colon.
//
// That matters because the repository already uses multi-segment names
// elsewhere (`test:unit:coverage`, `validate:metrics`, `_check:markdown:all`).
// A gate added as `check:links:external` would be a `check:*` gate by every
// other measure in this suite -- `tests/workflow-scripts.test.mjs:423` counts
// it with `/^(?:validate|check):/` and demands a workflow run it or record an
// exemption -- while silently never running under `npm run check`, which is
// what `npm test` runs and what CONTRIBUTING.md:208 describes as a superset of
// the CI checks. Nothing fails. The aggregate just quietly stops being one.
//
// The guards below read the real expansion out of npm rather than
// re-implementing the grep, so they are evidence about what `npm run check`
// actually does rather than a second copy of it that can agree with itself
// while disagreeing with the shell.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

const scripts =
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};

// Gates omitted from the aggregate on purpose, keyed by script name with the
// reason, following the GATES_NOT_RUN_BY_CI convention in
// workflow-scripts.test.mjs. Delete an entry when its gate joins the
// aggregate; the staleness guard below fails if one is left behind.
const GATES_NOT_IN_CHECK = new Map([]);

// `npm run check` never executes here. Only the enumerating helper runs, which
// shells out to `npm run` for its listing and greps it -- no gate, no network,
// no file written.
let memoizedMembers;
function checkAggregateMembers() {
  // Memoized: the expansion costs an npm start-up, and every guard below needs
  // the same answer about the same tree.
  memoizedMembers ??= execFileSync('npm', ['run', '-s', '_list:check:*'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return memoizedMembers;
}

function declaredCheckGates() {
  return Object.keys(scripts)
    .filter((name) => name.startsWith('check:'))
    .sort();
}

test('every check:* gate package.json declares is run by `npm run check`', () => {
  const members = new Set(checkAggregateMembers());
  const missing = declaredCheckGates().filter(
    (name) => !members.has(name) && !GATES_NOT_IN_CHECK.has(name),
  );
  assert.deepEqual(
    missing,
    [],
    'check:* gates that `npm run check` does not run -- most likely because ' +
      'the name carries a second colon, which the _list:check:* pattern ' +
      '`^\\s*check:[^:]+$` cannot match. Rename the gate to a single segment, ' +
      'or record the omission in GATES_NOT_IN_CHECK with a reason',
  );
});

test('everything `npm run check` runs is a declared gate', () => {
  // The other direction: the expansion is a grep over npm's own output, so a
  // script whose name merely looks like a gate would be run by the aggregate
  // without any of this suite's gate guards ever seeing it.
  const declared = new Set(declaredCheckGates());
  const strays = checkAggregateMembers()
    .filter((name) => !declared.has(name))
    .sort();
  assert.deepEqual(
    strays,
    [],
    '`npm run check` runs names that are not check:* scripts in package.json',
  );
});

test('every gate recorded as omitted is still omitted and still exists', () => {
  // Without this the table would absorb the fix as well as the fault: an entry
  // left behind after its gate joined the aggregate would keep excusing a
  // regression that dropped it out again.
  const members = new Set(checkAggregateMembers());
  const stale = [...GATES_NOT_IN_CHECK.keys()]
    .filter((name) => !(name in scripts) || members.has(name))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'GATES_NOT_IN_CHECK entries whose gate is undefined or is now run by ' +
      '`npm run check`; delete these entries',
  );
});

test('every recorded omission carries a reason', () => {
  const unexplained = [...GATES_NOT_IN_CHECK.entries()]
    .filter(([, reason]) => typeof reason !== 'string' || reason.trim() === '')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    unexplained,
    [],
    'omissions recorded without saying why the gate is not in the aggregate',
  );
});

test('the aggregate and its enumeration are not vacuous', () => {
  // Pins every guard above to evidence rather than to spelling. If
  // `_list:check:*` were renamed, or its grep stopped matching, the three
  // tests above would all pass over an empty expansion.
  assert.equal(
    scripts.check,
    'npm run seq -- $(npm run -s _list:check:*)',
    'the check aggregate no longer expands _list:check:*; this file reads ' +
      'that helper directly and must be updated with it',
  );

  const members = checkAggregateMembers();
  assert.ok(
    members.length > 1,
    `expected the aggregate to expand to several gates, got ${members.join(', ')}`,
  );
  for (const expected of ['check:format', 'check:spelling', 'check:markdown']) {
    assert.ok(
      members.includes(expected),
      `expected ${expected} in the aggregate, got ${members.join(', ')}`,
    );
  }
  assert.ok(
    declaredCheckGates().length >= members.length,
    'more names expand than package.json declares; the enumeration is ' +
      'reading something other than this repository',
  );
});
