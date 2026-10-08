// Compiles the additional fixture builds the end-to-end coverage run serves
// beside the ordinary coverage build.
//
// `npm run build:e2e:coverage` runs the ordinary coverage build first and then
// this script, which compiles one site per `tests/e2e/fixtures/data-<name>/`
// directory into `build/e2e-coverage-<name>` under base URL
// `/e2e-coverage-<name>/`. One `docusaurus serve` of build/ then offers all of
// them, so a single Playwright run visits the real pages and every fixture
// build, and tests/tools/e2e-coverage-report.mjs unions what each reached --
// the builds compile the same `src/**` sources, so their scripts fold onto the
// same lines.
//
// The loop lives here rather than in package.json because the build list is
// the directory listing (see tests/tools/e2e-data-fixtures.cjs): a shell
// one-liner would have to repeat the names, which is exactly the registry the
// directory convention exists to avoid.
//
// Each build is a full compile, so the job's wall time grows linearly in the
// number of fixture build directories.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { coverageBuildNames } = require('./e2e-data-fixtures.cjs');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function main() {
  const names = coverageBuildNames();
  if (names.length === 0) {
    // Not a no-op to shrug at: every variant spec asserts against a build
    // under /e2e-coverage-<name>/, so serving none of them would fail the
    // suite far from the cause.
    console.error(
      'No tests/e2e/fixtures/data-<name>/ directory: the end-to-end coverage run has no fixture build to serve.',
    );
    process.exit(1);
  }
  for (const name of names) {
    console.log(`\n==> e2e coverage build "${name}"`);
    const result = spawnSync(
      'npm',
      ['run', 'docus:build', '--', '--out-dir', `build/e2e-coverage-${name}`],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          DOCUSAURUS_NO_PERSISTENT_CACHE: '1',
          E2E_COVERAGE: '1',
          E2E_COVERAGE_BUILD: name,
          BASE_URL: `/e2e-coverage-${name}/`,
        },
      },
    );
    if (result.status !== 0) {
      console.error(`e2e coverage build "${name}" failed`);
      process.exit(result.status === null ? 1 : result.status);
    }
  }
}

main();
