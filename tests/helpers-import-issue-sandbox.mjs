import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

// scripts/import-architecture-issue.mjs mirrors CNCF project logos over the
// network. The sandbox below mirrors the repo layout in a temp directory and
// stubs fetch so the script can be exercised offline, the same approach
// helpers-import-sandbox.mjs uses for the cncf/architecture importer.
const FETCH_STUB = `import { readFileSync } from 'node:fs';

const responses = JSON.parse(readFileSync(process.env.FAKE_FETCH, 'utf8'));

globalThis.fetch = async (url) => {
  const fixture = responses[String(url)];
  if (!fixture) throw new Error(\`unstubbed fetch: \${url}\`);
  if (fixture.networkError) throw new Error('network unreachable');
  return {
    ok: fixture.status >= 200 && fixture.status < 300,
    status: fixture.status,
    arrayBuffer: async () => Buffer.from(fixture.body ?? '', 'utf8'),
  };
};
`;

/**
 * Runs scripts/import-architecture-issue.mjs against a fixture issue payload.
 *
 * @param {object} options
 * @param {object} options.issue The issue payload; either a bare issue object
 *   or one already wrapped in `{ issue: ... }` as GitHub's webhook event does.
 * @param {Record<string, {status?: number, body?: string, networkError?: boolean}>} [options.fetchResponses]
 *   Stubbed responses keyed by absolute URL.
 * @param {Record<string, unknown>} [options.catalog] Pre-existing
 *   data/architectures/catalog.json content.
 * @param {string[]} [options.args] Extra CLI arguments.
 * @returns {{status: number, stdout: string, stderr: string, work: string,
 *   read: (relativePath: string) => string, readJson: (relativePath: string) => unknown,
 *   exists: (relativePath: string) => boolean, cleanup: () => void}}
 */
export function runImportArchitectureIssue({
  issue,
  fetchResponses = {},
  catalog,
  args = [],
}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-import-issue-'));

  mkdirSync(join(work, 'scripts'), { recursive: true });
  writeFileSync(
    join(work, 'scripts', 'import-architecture-issue.mjs'),
    readFileSync(
      join(repoRoot, 'scripts', 'import-architecture-issue.mjs'),
      'utf8',
    ),
  );
  // The script imports helper modules from scripts/lib; mirror the whole
  // directory so new lib imports do not break the sandbox.
  cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
    recursive: true,
  });
  symlinkSync(join(repoRoot, 'node_modules'), join(work, 'node_modules'));
  mkdirSync(join(work, 'docs', 'architectures'), { recursive: true });
  mkdirSync(join(work, 'data', 'architectures', 'records'), {
    recursive: true,
  });
  if (catalog !== undefined) {
    writeFileSync(
      join(work, 'data', 'architectures', 'catalog.json'),
      JSON.stringify(catalog, null, 2) + '\n',
    );
  }

  const issuePath = join(work, 'issue.json');
  writeFileSync(issuePath, JSON.stringify(issue));

  const fetchFixture = join(work, 'fetch-fixture.json');
  writeFileSync(fetchFixture, JSON.stringify(fetchResponses));
  writeFileSync(join(work, 'stub-fetch.mjs'), FETCH_STUB);

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      join(work, 'stub-fetch.mjs'),
      'scripts/import-architecture-issue.mjs',
      '--issue-json',
      issuePath,
      ...args,
    ],
    {
      cwd: work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FAKE_FETCH: fetchFixture,
      },
    },
  );

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    work,
    read: (relativePath) => readFileSync(join(work, relativePath), 'utf8'),
    readJson: (relativePath) =>
      JSON.parse(readFileSync(join(work, relativePath), 'utf8')),
    exists: (relativePath) => existsSync(join(work, relativePath)),
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}
