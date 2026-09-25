import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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

// scripts/import-architectures.mjs runs on import, clones cncf/architecture
// with git and mirrors project logos over the network. The sandbox below
// mirrors the repo layout in a temp directory and replaces both external
// dependencies so the script can be exercised offline:
//
//   - a `git` stub earlier on PATH copies an upstream fixture tree instead of
//     cloning, and reports a fixed revision for `rev-parse HEAD`
//   - a `--import` preload replaces globalThis.fetch with a fixture lookup
//
// The script resolves its inputs and outputs from its own import.meta.url, so
// a copy placed in <work>/scripts/ writes to <work>/ instead of the real repo.

const GIT_STUB = `#!/bin/sh
case "$1" in
  clone)
    for arg in "$@"; do dest="$arg"; done
    mkdir -p "$dest"
    cp -R "$FAKE_UPSTREAM"/. "$dest"/
    ;;
  -C)
    printf '%s\\n' "$FAKE_COMMIT"
    ;;
  *)
    echo "unexpected git invocation: $*" >&2
    exit 1
    ;;
esac
`;

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

// Stands in for rsvg-convert, which the script shells out to when an SVG
// embeds raster data. Writes the PNG the real converter would produce.
const RSVG_STUB = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$out" ] || exit 1
printf 'converted-png' > "$out"
`;

export const FAKE_COMMIT = 'a'.repeat(40);

/**
 * Runs scripts/import-architectures.mjs against fixture data.
 *
 * @param {object} options
 * @param {Record<string, string>} options.upstream Files placed under the
 *   cloned upstream checkout, keyed by path relative to the clone root
 *   (for example `content/en/architectures/acme/index.md`).
 * @param {Record<string, string>} [options.upstreamSymlinks] Symlinks placed
 *   under the cloned upstream checkout, keyed by path relative to the clone
 *   root and valued by link target. The `git clone` stub copies the fixture
 *   with `cp -R`, which preserves symlinks, so these reach the importer the
 *   same way a symlink committed upstream would.
 * @param {string[]} [options.upstreamFifos] Named pipes created under the
 *   cloned upstream checkout, keyed by path relative to the clone root. A FIFO
 *   is neither a regular file nor a directory nor a symlink, which is the only
 *   way to reach walkFiles()' final rejection arm. `cp -R` recreates a FIFO as
 *   a FIFO, so these reach the importer the way a special file in the upstream
 *   checkout would.
 * @param {Record<string, {status?: number, body?: string, networkError?: boolean}>} [options.fetchResponses]
 *   Stubbed responses keyed by absolute URL.
 * @param {Record<string, string>} [options.repoFiles] Extra files placed in the
 *   sandboxed repo root before the script runs.
 * @param {'success'|'failure'} [options.rsvgConvert] Behaviour of the stubbed
 *   rsvg-convert binary used for raster-embedded SVGs. `failure` simulates the
 *   converter being unavailable.
 * @returns {{status: number, stdout: string, stderr: string, work: string,
 *   read: (relativePath: string) => string, readJson: (relativePath: string) => unknown,
 *   exists: (relativePath: string) => boolean, cleanup: () => void}}
 */
export function runImportArchitectures({
  upstream,
  upstreamSymlinks = {},
  upstreamFifos = [],
  fetchResponses = {},
  repoFiles = {},
  rsvgConvert = 'success',
}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-import-'));
  const writeAt = (base, relativePath, content) => {
    const target = join(base, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  mkdirSync(join(work, 'scripts'), { recursive: true });
  writeFileSync(
    join(work, 'scripts', 'import-architectures.mjs'),
    readFileSync(join(repoRoot, 'scripts', 'import-architectures.mjs'), 'utf8'),
  );
  // The script imports helper modules from scripts/lib; mirror the whole
  // directory so new lib imports do not break the sandbox.
  cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
    recursive: true,
  });
  // `yaml` is imported by the script; resolve it from the repo install.
  symlinkSync(join(repoRoot, 'node_modules'), join(work, 'node_modules'));
  // The script writes docs pages without creating the directory first.
  mkdirSync(join(work, 'docs', 'architectures'), { recursive: true });
  mkdirSync(join(work, 'data', 'architectures'), { recursive: true });

  const upstreamFixture = join(work, 'upstream-fixture');
  for (const [relativePath, content] of Object.entries(upstream)) {
    writeAt(upstreamFixture, relativePath, content);
  }
  for (const [relativePath, linkTarget] of Object.entries(upstreamSymlinks)) {
    const link = join(upstreamFixture, relativePath);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(linkTarget, link);
  }
  for (const relativePath of upstreamFifos) {
    const fifo = join(upstreamFixture, relativePath);
    mkdirSync(dirname(fifo), { recursive: true });
    // Node has no mkfifo binding, so shell out. Every platform the suite runs
    // on ships mkfifo; a failure here is a broken fixture, not a skip.
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    if (made.status !== 0) {
      throw new Error(`could not create FIFO ${relativePath}: ${made.stderr}`);
    }
  }
  for (const [relativePath, content] of Object.entries(repoFiles)) {
    writeAt(work, relativePath, content);
  }

  const binDir = join(work, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'git'), GIT_STUB);
  chmodSync(join(binDir, 'git'), 0o755);
  // Always shadow rsvg-convert so the outcome does not depend on the host.
  writeFileSync(
    join(binDir, 'rsvg-convert'),
    rsvgConvert === 'success' ? RSVG_STUB : '#!/bin/sh\nexit 1\n',
  );
  chmodSync(join(binDir, 'rsvg-convert'), 0o755);

  const fetchFixture = join(work, 'fetch-fixture.json');
  writeFileSync(fetchFixture, JSON.stringify(fetchResponses));
  writeFileSync(join(work, 'stub-fetch.mjs'), FETCH_STUB);

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      join(work, 'stub-fetch.mjs'),
      'scripts/import-architectures.mjs',
    ],
    {
      cwd: work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_UPSTREAM: upstreamFixture,
        FAKE_COMMIT,
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
