// Guards the half of the fixture-build contract that points from the build
// back to the suite: every build the coverage run compiles must be reached by
// at least one spec.
//
// `tests/tools/e2e-data-fixtures.cjs` makes the build list a directory
// listing: every `tests/e2e/fixtures/data-<name>/` directory declares one more
// Docusaurus compile, and nothing else has to be told about it. That is what
// makes a new overlay cheap to add, and it is also what makes an orphaned one
// invisible. The module header states the cost in the same breath: "Each build
// is a full Docusaurus compile, so CI time for the end-to-end coverage job
// grows linearly in the number of `data-<name>/` directories." A build no spec
// navigates to is that compile paid on every pull request, serving a site
// nobody opens, covering nothing the ordinary build did not already cover.
//
// Why the existing tests do not see this. The direction they guard is the
// other one. `tests/e2e-data-fixtures.test.mjs` asserts that every build name
// is a directory and every directory is a build -- its comment even names the
// failure it is watching for, "a spec asserting against a route that 404s",
// which is a spec without a build, not a build without a spec. It then pins
// the two current names with `names.includes('variant')` and
// `names.includes('no-revision')`, so both assertions keep passing for a
// directory whose last spec was deleted. `tests/e2e-coverage-builds.test.mjs`
// checks that the compiler loops over whatever `coverageBuildNames()` returns
// and derives the right out-dir and base URL; it is indifferent to whether the
// resulting site is ever requested. Playwright cannot report the gap either:
// an unvisited build produces no failing test, only a slower job.
//
// What a spec has to show to count. Two things, because either alone is weak.
// The base path `/e2e-coverage-<name>` is how a spec addresses the build's
// site, and `E2E_COVERAGE_BUILD: '<name>'` is how it reads that build's
// overlaid data back through `loadSiteData()` -- the pairing the variant specs
// already use, and the one that makes an assertion about a missing element
// evidence that an arm switched rather than that a page failed to build. A
// spec that names the base path but never resolves the build's data is
// asserting against a route it cannot describe; one that loads the data but
// never names the base path never opens the site at all.
//
// The check is textual on purpose. Importing the specs would need Playwright's
// runner and a built site; the strings above are the literal form every
// current spec uses, and requiring them keeps the contract something a new
// spec satisfies by being written the way the existing ones are.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

import { resolveRepoRoot } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { coverageBuildNames } = require('./tools/e2e-data-fixtures.cjs');

const repoRoot = resolveRepoRoot(import.meta.url);
const specDir = join(repoRoot, 'tests', 'e2e');

function specSources() {
  return readdirSync(specDir)
    .filter((entry) => entry.endsWith('.spec.js'))
    .map((entry) => ({
      name: entry,
      source: readFileSync(join(specDir, entry), 'utf8'),
    }));
}

// `/e2e-coverage-variant` is a prefix of `/e2e-coverage-variant-extra`, so the
// match is anchored on the characters a build name cannot contain. Without the
// boundary a future build would be credited by the spec that visits an
// unrelated site whose name happens to start the same way.
function mentionsBasePath(source, name) {
  return new RegExp(`/e2e-coverage-${name}(?![\\w-])`).test(source);
}

function mentionsBuildEnv(source, name) {
  return new RegExp(`E2E_COVERAGE_BUILD:\\s*'${name}'`).test(source);
}

test('every fixture build is visited by at least one e2e spec', () => {
  const names = coverageBuildNames();
  assert.ok(names.length > 0, 'the repository must declare a fixture build');

  const specs = specSources();
  assert.ok(specs.length > 0, 'tests/e2e must contain specs');

  for (const name of names) {
    const visiting = specs.filter((spec) =>
      mentionsBasePath(spec.source, name),
    );
    assert.ok(
      visiting.length > 0,
      `${name}: no spec navigates /e2e-coverage-${name}; the build is a ` +
        'full Docusaurus compile on every run that covers nothing. Delete ' +
        `tests/e2e/fixtures/data-${name}/ or write the spec that uses it.`,
    );
    assert.ok(
      visiting.some((spec) => mentionsBuildEnv(spec.source, name)),
      `${name}: ${visiting.map((spec) => spec.name).join(', ')} name the ` +
        `build's base path but none resolve its data with ` +
        `E2E_COVERAGE_BUILD: '${name}', so nothing asserts the overlay the ` +
        'build exists for is the one being rendered.',
    );
  }
});

// The companion to the test above, for the ordinary coverage build. It has no
// `data-<name>/` directory of its own -- `tests/e2e/fixtures/data/` applies to
// every build -- so it can never appear in `coverageBuildNames()`, and a spec
// that addressed it by a base path would be addressing the site root. Pinning
// that here keeps a later reader from "fixing" the loop above by adding the
// ordinary build to the name list.
test('the ordinary coverage build is not a named fixture build', () => {
  assert.ok(
    !coverageBuildNames().includes(''),
    'the ordinary build is addressed by the site root, not a build name',
  );
  for (const spec of specSources())
    assert.ok(
      !/\/e2e-coverage\//.test(spec.source),
      `${spec.name}: /e2e-coverage/ is not a route any build serves`,
    );
});
