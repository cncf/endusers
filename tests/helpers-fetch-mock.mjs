import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

// Preload module source injected with `node --import`. It replaces globalThis.fetch
// before the script under test is evaluated, so network-dependent scripts run
// offline and deterministically. Routes match by substring against the URL.
const FETCH_STUB = `
const routes = JSON.parse(process.env.ENDUSERS_FETCH_ROUTES ?? '[]');
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const route = routes.find((candidate) => url.includes(candidate.match));
  if (!route) throw new Error('unstubbed request: ' + url);
  if (route.networkError) throw new Error(route.networkError);
  const status = route.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(route.headers ?? {}),
    json: async () => route.body ?? {},
  };
};
`;

/**
 * Runs a script from scripts/ against fixture data with a stubbed global fetch.
 *
 * Mirrors the repo layout in a temp directory the same way runScriptWithFixtures
 * does: the scripts resolve inputs relative to their own import.meta.url, so a
 * copy placed in <tmp>/scripts/ reads fixtures from <tmp>/ rather than the real
 * repo. Output files named in `outputs` are read before the temp tree is removed.
 *
 * @param {object} options
 * @param {string} options.script file name inside scripts/
 * @param {Record<string, string>} [options.fixtures] repo-relative path -> contents
 * @param {Array<{match: string, status?: number, body?: unknown,
 *   headers?: Record<string, string>, networkError?: string}>} [options.routes]
 * @param {string[]} [options.outputs] repo-relative paths to read back afterwards
 * @param {Record<string, string>} [options.env] extra environment variables
 * @returns {{status: number, stdout: string, stderr: string,
 *   outputs: Record<string, string | null>}}
 */
export function runScriptWithFetchMock({
  script,
  fixtures = {},
  routes = [],
  outputs = [],
  env = {},
}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-fetch-test-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'scripts', script), join(work, 'scripts', script));
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });
    for (const [relativePath, content] of Object.entries(fixtures)) {
      const target = join(work, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    const stubPath = join(work, 'fetch-stub.mjs');
    writeFileSync(stubPath, FETCH_STUB);

    const result = spawnSync(
      'node',
      ['--import', stubPath, join(work, 'scripts', script)],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Keep the child off any ambient credential so runs stay reproducible
          // whether or not the developer or CI job exports a token.
          GH_TOKEN: '',
          ENDUSERS_FETCH_ROUTES: JSON.stringify(routes),
          ...env,
        },
      },
    );

    const collected = {};
    for (const relativePath of outputs) {
      const target = join(work, relativePath);
      collected[relativePath] = existsSync(target)
        ? readFileSync(target, 'utf8')
        : null;
    }

    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      outputs: collected,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
