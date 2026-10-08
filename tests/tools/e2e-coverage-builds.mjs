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
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { coverageBuildNames } = require('./e2e-data-fixtures.cjs');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The compile one named fixture build runs.
 *
 * Both the output directory and the base URL are derived from the build name,
 * which is what lets a new build be a new `tests/e2e/fixtures/data-<name>/`
 * directory and nothing else. The build opts out of the persistent bundler
 * cache because every pass compiles the same sources from different data, so
 * a shared cache would replay one build's output into the next.
 *
 * @param {string} name build name, without the `data-` prefix
 * @param {NodeJS.ProcessEnv} [env] environment the build inherits
 * @returns {{command: string, args: string[], options: object}}
 */
export function buildCommand(name, env = process.env) {
  return {
    command: 'npm',
    args: [
      'run',
      'docus:build',
      '--',
      '--out-dir',
      `build/e2e-coverage-${name}`,
    ],
    options: {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...env,
        DOCUSAURUS_NO_PERSISTENT_CACHE: '1',
        E2E_COVERAGE: '1',
        E2E_COVERAGE_BUILD: name,
        BASE_URL: `/e2e-coverage-${name}/`,
      },
    },
  };
}

/**
 * Compiles every named fixture build, stopping at the first failure.
 *
 * @param {object} [deps]
 * @param {string[]} [deps.names] builds to compile
 * @param {Function} [deps.spawn] `spawnSync`-shaped runner
 * @param {Function} [deps.log] progress sink
 * @param {Function} [deps.error] failure sink
 * @returns {number} process exit code
 */
export function main({
  names = coverageBuildNames(),
  spawn = spawnSync,
  log = console.log,
  error = console.error,
} = {}) {
  if (names.length === 0) {
    // Not a no-op to shrug at: every variant spec asserts against a build
    // under /e2e-coverage-<name>/, so serving none of them would fail the
    // suite far from the cause.
    error(
      'No tests/e2e/fixtures/data-<name>/ directory: the end-to-end coverage run has no fixture build to serve.',
    );
    return 1;
  }
  for (const name of names) {
    log(`\n==> e2e coverage build "${name}"`);
    const { command, args, options } = buildCommand(name);
    const result = spawn(command, args, options);
    if (result.status !== 0) {
      error(`e2e coverage build "${name}" failed`);
      return result.status === null ? 1 : result.status;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main());
}
