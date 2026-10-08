import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Several end-to-end cases select the record they drive out of the committed
// data rather than naming it, and call `test.skip()` when the data holds no
// such record. That is the right shape -- the files are regenerated from
// upstream on a schedule, so naming a record would make the spec fail on an
// unrelated refresh -- but it fails open. Playwright reports a skipped case as
// a non-failure, so the day the upstream refresh removes the last matching
// record, the case stops exercising the browser and CI stays green with no
// signal that the coverage retired.
//
// tests/e2e/member-directory.spec.js:20-27 states the hazard for its own case
// and defends it under the coverage build only:
//
//   > on the day the landscape gives both of them one, a `test.skip` reading
//   > the real file would quietly retire the dialog's only browser coverage of
//   > the initials arm. A green run would report nothing, because a skipped
//   > case is not a failing one.
//
// Nothing defends the other sites, and nothing defends any of them in the
// plain "End-to-end tests" job, which runs without E2E_COVERAGE. This guard
// closes that: it runs in the unit suite, which CI runs on every pull request,
// and it fails loudly when the committed data stops satisfying a predicate
// that an end-to-end case depends on.
//
// It has two halves, and both are necessary. The predicate checks below turn a
// silent skip into a failing unit test. The inventory check keeps the list
// honest: a `test.skip()` added to a spec without a matching entry here would
// otherwise reintroduce exactly the silent-skip hazard this file exists to
// remove.
//
// `test.describe.skip` is deliberately not scanned. The coverage-only describe
// blocks (`process.env.E2E_COVERAGE === '1' ? test.describe :
// test.describe.skip`) turn on the build, not on the data: outside the
// coverage run the variant site does not exist, so skipping is correct and is
// not data-dependent.

const root = fileURLToPath(new URL('..', import.meta.url));
const specDir = join(root, 'tests', 'e2e');

const readData = (name) =>
  JSON.parse(readFileSync(join(root, 'data', name), 'utf8'));

const awardsData = readData('awards.json');
const peopleData = readData('community-people.json');
const membersData = readData('members.json');
const metricsData = readData('metrics.json');
const radarData = readData('radar-reports.json');

// The handles tests/e2e/community-people.spec.js:285 reads, as a list rather
// than a chain of `||` so that the first missing one does not leave the rest
// of the predicate unexecuted.
const HANDLES = ['linkedin', 'twitter', 'blog', 'github'];

// Read without optional chaining or a fallback: the envelopes are already
// pinned by tests/community-people-data.test.mjs:61 and
// tests/members-data.test.mjs:81, so a missing container is that guard's
// failure to report, not a shape this file should absorb into an empty list
// and then blame on the data.
const tabPeople = peopleData.people.tab;
const members = membersData.members;

// One entry per data-dependent `test.skip()` in tests/e2e/**. `reason` is the
// skip's own message, which is what ties an entry to its call site: line
// numbers move whenever a spec is edited, the message does not.
//
// `holds()` returns true when the committed data still satisfies the case, so
// it is the negation of the skip condition written at the call site. Keeping
// it as the positive statement makes the assertion message below read as what
// the data must provide rather than as what must not be true of it.
const SKIPS = [
  {
    spec: 'awards.spec.js',
    reason: 'data/awards.json declares no verification provenance',
    needs: 'data/awards.json carries both verifiedAt and verifiedAgainst',
    holds: () =>
      Boolean(awardsData.verifiedAt) && Boolean(awardsData.verifiedAgainst),
  },
  {
    spec: 'community-people.spec.js',
    reason: 'data/community-people.json defines no TAB people',
    needs: 'data/community-people.json lists at least one TAB person',
    holds: () => tabPeople.length > 0,
  },
  {
    spec: 'community-people.spec.js',
    reason: 'every TAB person currently carries every handle',
    needs:
      'at least one TAB person is missing one of linkedin/twitter/blog/github',
    holds: () =>
      tabPeople.some((person) => HANDLES.some((handle) => !person[handle])),
  },
  {
    spec: 'community-people.spec.js',
    reason: 'no TAB person currently carries a bio',
    needs: 'at least one TAB person carries a bio',
    holds: () => tabPeople.some((person) => person.bio),
  },
  {
    spec: 'community-people.spec.js',
    reason: 'every TAB person currently carries a bio',
    needs: 'at least one TAB person carries no bio',
    holds: () => tabPeople.some((person) => !person.bio),
  },
  {
    spec: 'community-people.spec.js',
    reason: 'the roster has no contrasting pair',
    needs: 'the TAB roster holds both a person with a location and one without',
    holds: () =>
      tabPeople.some((person) => person.location) &&
      tabPeople.some((person) => !person.location),
  },
  {
    spec: 'member-directory.spec.js',
    reason: 'every member in data/members.json carries a logo',
    needs: 'at least one member carries no logo',
    holds: () => members.some((member) => !member.logo),
  },
  {
    spec: 'member-directory.spec.js',
    reason: 'no member in data/members.json carries a logo',
    needs: 'at least one member carries a logo',
    holds: () => members.some((member) => member.logo),
  },
  {
    spec: 'metrics-dashboard.spec.js',
    reason: 'no omitted lifecycle indicators to show',
    needs: 'data/metrics.json omits at least one lifecycle indicator',
    // scripts/validate-metrics.mjs:143 treats both the section and its
    // `omitted` list as optional, so an absent one is a shape the data may
    // legitimately take and this guard must report rather than throw on.
    holds: () =>
      (metricsData.referenceArchitectureLifecycle?.omitted ?? []).length > 0,
  },
  {
    spec: 'radar-reports.spec.js',
    reason:
      'the component renders no provenance line for a corpus without generatedAt',
    needs: 'data/radar-reports.json carries a generatedAt',
    holds: () => Boolean(radarData.generatedAt),
  },
];

// Removes comments so that a commented-out call or a prose mention of
// `test.skip(` is never counted as a live call site.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Reads the skip's message argument. Every call site in this repository writes
// it as a single-quoted literal, either on the condition's line or on the line
// after it; the 400-character window covers the longest multi-line form in
// tests/e2e/** with room to spare.
function skipSites() {
  const sites = [];
  for (const name of readdirSync(specDir).filter((entry) =>
    entry.endsWith('.spec.js'),
  )) {
    const source = stripComments(readFileSync(join(specDir, name), 'utf8'));
    const pattern = /test\.skip\(/g;
    let match;
    while ((match = pattern.exec(source))) {
      const window = source.slice(match.index, match.index + 400);
      const message = /'((?:[^'\\]|\\.)+)'/.exec(window);
      const line = source.slice(0, match.index).split('\n').length;
      sites.push({
        spec: name,
        line,
        reason: message ? message[1].replace(/\s+/g, ' ') : null,
      });
    }
  }
  return sites;
}

const key = (entry) => `${entry.spec}: ${entry.reason}`;

test('every data-dependent test.skip in tests/e2e is registered here', () => {
  const sites = skipSites();

  const unreadable = sites.filter((site) => !site.reason);
  assert.deepEqual(
    unreadable,
    [],
    'a test.skip() call has no single-quoted message, so it cannot be tied to an entry in SKIPS',
  );

  const found = sites.map(key).sort();
  const registered = SKIPS.map(key).sort();

  assert.deepEqual(
    found,
    registered,
    'tests/e2e holds a data-dependent test.skip() that is not registered in SKIPS (or SKIPS names one that no longer exists). Add or remove the entry, with the predicate the data must satisfy for the case to run.',
  );
});

for (const entry of SKIPS) {
  test(`${entry.spec} still runs the case that skips when ${entry.reason}`, () => {
    assert.equal(
      entry.holds(),
      true,
      `${entry.spec} skips a case because the committed data no longer satisfies it: ${entry.needs}. ` +
        'A skipped end-to-end case is not a failing one, so this would otherwise retire browser coverage with a green run. ' +
        'Either restore the data shape, or give the case a fixture record the way tests/e2e/fixtures/data/members.json does.',
    );
  });
}
