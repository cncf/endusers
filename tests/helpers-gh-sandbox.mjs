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
import { resolveRepoRoot } from './helpers.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);

// Stub placed first on PATH so a script that shells out to `gh` never reaches
// the network or a real credential. Every invocation is appended to a log file
// as a JSON argv array, so a test can assert on the calls a script made (which
// pages it requested, which labels it edited, what it commented) rather than
// only on stdout. Routes match by substring against the joined argv and are
// consulted in declaration order, so more specific routes come first.
const GH_STUB_BODY = `import { appendFileSync } from 'node:fs';

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
export function runWithGhStub({
  script,
  driver,
  routes = [],
  env = {},
  spawnPath,
}) {
  return runWithStub({ tool: 'gh', script, driver, routes, env, spawnPath });
}

/**
 * Like runWithGhStub, but stubs `curl` instead of `gh` and isolates PATH to
 * the stub directory plus node's own directory, so a script that shells out
 * to `gh` hits a genuine ENOENT and falls back to its `curl` path. Routes
 * match by substring against the joined curl argv (which ends with the
 * request URL), and invocations are logged exactly as with the gh stub.
 */
export function runWithCurlStub({ script, driver, routes = [], env = {} }) {
  return runWithStub({
    tool: 'curl',
    script,
    driver,
    routes,
    env,
    isolatePath: true,
  });
}

function runWithStub({
  tool,
  script,
  driver,
  routes,
  env,
  isolatePath = false,
  spawnPath,
}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-gh-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'scripts', script), join(work, 'scripts', script));
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    const stub = join(binDir, tool);
    // Shebang points at the running node directly: with an isolated PATH
    // (curl-fallback tests) there is no `/usr/bin/env node` lookup to rely
    // on, and no real `gh`/`curl` may leak in from node's own directory.
    writeFileSync(stub, `#!${process.execPath}\n${GH_STUB_BODY}`);
    chmodSync(stub, 0o755);

    const logPath = join(work, 'gh-calls.log');
    let entry = join(work, 'scripts', script);
    if (driver) {
      entry = join(work, 'driver.mjs');
      writeFileSync(entry, driver);
    }

    // spawnPath defaults to the running node by absolute path, so the child
    // starts even with an isolated or unset PATH; tests override it to
    // exercise the spawn-failure degradation below.
    const result = spawnSync(spawnPath ?? process.execPath, [entry], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: isolatePath
          ? binDir
          : `${binDir}${delimiter}${process.env.PATH ?? ''}`,
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
