import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

// Stub placed first on PATH so a script that shells out to `gh` never reaches
// the network or a real credential. Every invocation is appended to a log file
// as a JSON argv array, so a test can assert on the calls a script made (which
// pages it requested, which labels it edited, what it commented) rather than
// only on stdout. Routes match by substring against the joined argv and are
// consulted in declaration order, so more specific routes come first.
const GH_STUB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
appendFileSync(process.env.ENDUSERS_GH_LOG, JSON.stringify(argv) + '\\n');

const routes = JSON.parse(process.env.ENDUSERS_GH_ROUTES ?? '[]');
const joined = argv.join(' ');
const route = routes.find((candidate) => joined.includes(candidate.match));
if (!route) {
  process.stderr.write('unstubbed gh invocation: ' + joined + '\\n');
  process.exit(1);
}
if (route.stderr) process.stderr.write(route.stderr);
process.stdout.write(route.stdout ?? '');
process.exit(route.status ?? 0);
`;

/**
 * Runs a script from scripts/ — or an inline driver module that imports it —
 * with `gh` replaced by a logging stub.
 *
 * The script is copied into a temp directory alongside scripts/lib, so a
 * module that resolves siblings from its own import.meta.url still loads. Pass
 * `driver` to exercise exported functions in isolation; omit it to run the
 * script itself, which is the only way to reach a `main()` guarded by
 * `import.meta.url === file://process.argv[1]`.
 *
 * @param {object} options
 * @param {string} options.script file name inside scripts/
 * @param {string} [options.driver] ESM source run instead of the script; it can
 *   import the script under test as './scripts/<script>'
 * @param {Array<{match: string, stdout?: string, stderr?: string,
 *   status?: number}>} [options.routes] gh responses, matched in order
 * @param {Record<string, string>} [options.env] extra environment variables
 * @returns {{status: number, stdout: string, stderr: string,
 *   calls: string[][]}} `calls` is one argv array per gh invocation, in order
 */
export function runWithGhStub({ script, driver, routes = [], env = {} }) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-gh-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'scripts', script), join(work, 'scripts', script));
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    const stub = join(binDir, 'gh');
    writeFileSync(stub, GH_STUB);
    chmodSync(stub, 0o755);

    const logPath = join(work, 'gh-calls.log');
    let entry = join(work, 'scripts', script);
    if (driver) {
      entry = join(work, 'driver.mjs');
      writeFileSync(entry, driver);
    }

    const result = spawnSync('node', [entry], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        // Keep the child off any ambient credential and off the ambient repo,
        // so a run is identical whether or not the developer or CI job exports
        // GH_TOKEN or GITHUB_REPOSITORY.
        GH_TOKEN: '',
        GITHUB_REPOSITORY: '',
        REPO: '',
        DRY_RUN: '',
        MARKER_AUTHORS: '',
        ENDUSERS_GH_LOG: logPath,
        ENDUSERS_GH_ROUTES: JSON.stringify(routes),
        ...env,
      },
    });

    const calls = existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];

    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      calls,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
