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
import { delimiter, dirname, join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

// Preload module injected with `node --import`. It replaces globalThis.fetch
// before the script under test is evaluated, so network-dependent scripts run
// offline and deterministically. Routes match by substring against the URL and
// are consulted in declaration order, so more specific routes come first.
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
    json: async () => route.body ?? [],
  };
};
`;

// Shim placed first on PATH so a script that shells out to `git clone <url>`
// gets a local fixture repository instead of reaching the network. Every other
// git invocation is delegated to the real binary, so `rev-parse` and `log` keep
// their real semantics; `fetch --unshallow` becomes a no-op because the fixture
// clone is already complete.
const GIT_SHIM = `#!/usr/bin/env bash
set -euo pipefail
real_git="$ENDUSERS_REAL_GIT"
for arg in "$@"; do
  if [ "$arg" = "--unshallow" ]; then exit 0; fi
done
if [ "\${1:-}" != "clone" ]; then exec "$real_git" "$@"; fi
args=("$@")
dest="\${args[$((\${#args[@]} - 1))]}"
url="\${args[$((\${#args[@]} - 2))]}"
name="\${url##*/}"
name="\${name%.git}"
source_tree="$ENDUSERS_GIT_FIXTURES/$name"
if [ ! -d "$source_tree" ]; then
  echo "git shim: no fixture repository for $url" >&2
  exit 128
fi
mkdir -p "$dest"
cp -R "$source_tree/." "$dest/"
cd "$dest"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=fixture GIT_AUTHOR_EMAIL=fixture@example.com
export GIT_COMMITTER_NAME=fixture GIT_COMMITTER_EMAIL=fixture@example.com
"$real_git" init -q -b main
dates_var="ENDUSERS_GIT_DATES_\${name//[^A-Za-z0-9]/_}"
dates="\${!dates_var:-}"
if [ -z "$dates" ]; then
  "$real_git" add -A
  GIT_AUTHOR_DATE="2024-01-01T00:00:00Z" GIT_COMMITTER_DATE="2024-01-01T00:00:00Z" \\
    "$real_git" commit -q -m "fixture" --allow-empty
  exit 0
fi
first=1
IFS=',' read -ra stamps <<< "$dates"
for stamp in "\${stamps[@]}"; do
  if [ "$first" = "1" ]; then
    first=0
  else
    mkdir -p content/en/architectures
    echo "$stamp" >> content/en/architectures/.timeline
  fi
  "$real_git" add -A
  GIT_AUTHOR_DATE="$stamp" GIT_COMMITTER_DATE="$stamp" \\
    "$real_git" commit -q -m "fixture $stamp" --allow-empty
done
exit 0
`;

/**
 * Runs a script from scripts/ in a sandbox that mirrors the repository layout,
 * stubs global fetch, and intercepts `git clone` with local fixture repos.
 *
 * The scripts resolve paths relative to their own import.meta.url, so a copy
 * placed in <tmp>/scripts/ reads and writes <tmp>/ instead of the real repo.
 * node_modules is symlinked so third-party imports (for example `yaml`)
 * still resolve.
 *
 * @param {object} options
 * @param {string} options.script file name inside scripts/
 * @param {Record<string, string>} [options.fixtures] repo-relative path -> contents
 * @param {Record<string, Record<string, string>>} [options.repos] clone target
 *   name (the URL basename without .git) -> repo-relative path -> contents
 * @param {Record<string, string[]>} [options.repoCommitDates] clone target name
 *   -> ISO author dates, one commit each; commits after the first touch
 *   content/en/architectures so path-filtered history is exercised
 * @param {Array<{match: string, status?: number, body?: unknown,
 *   headers?: Record<string, string>, networkError?: string}>} [options.routes]
 * @param {string[]} [options.outputs] repo-relative paths to read back afterwards
 * @param {Record<string, string>} [options.env] extra environment variables
 * @returns {{status: number, stdout: string, stderr: string,
 *   outputs: Record<string, string | null>}}
 */
export function runScriptInSandbox({
  script,
  fixtures = {},
  repos = {},
  repoCommitDates = {},
  routes = [],
  outputs = [],
  env = {},
}) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-sandbox-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(join(repoRoot, 'scripts', script), join(work, 'scripts', script));
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });
    symlinkSync(join(repoRoot, 'node_modules'), join(work, 'node_modules'));

    writeFiles(work, fixtures);

    const fixtureRepos = join(work, '.fixture-repos');
    const repoDates = {};
    for (const [name, tree] of Object.entries(repos)) {
      mkdirSync(join(fixtureRepos, name), { recursive: true });
      writeFiles(join(fixtureRepos, name), tree);
      const dates = repoCommitDates[name];
      if (dates?.length) {
        repoDates[`ENDUSERS_GIT_DATES_${name.replace(/[^A-Za-z0-9]/g, '_')}`] =
          dates.join(',');
      }
    }

    const binDir = join(work, '.bin');
    mkdirSync(binDir, { recursive: true });
    const gitShim = join(binDir, 'git');
    writeFileSync(gitShim, GIT_SHIM);
    chmodSync(gitShim, 0o755);

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
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
          // Keep the child off any ambient credential so runs stay reproducible
          // whether or not the developer or CI job exports a token.
          GH_TOKEN: '',
          ENDUSERS_FETCH_ROUTES: JSON.stringify(routes),
          ENDUSERS_GIT_FIXTURES: fixtureRepos,
          ENDUSERS_REAL_GIT: realGitPath(),
          ...repoDates,
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

function writeFiles(base, tree) {
  for (const [relativePath, content] of Object.entries(tree)) {
    const target = join(base, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

// Resolved before the shim directory is prepended to PATH so the shim delegates
// to the real binary instead of recursing into itself.
function realGitPath() {
  const found = spawnSync('command', ['-v', 'git'], {
    encoding: 'utf8',
    shell: true,
  });
  return (found.stdout ?? '').trim() || '/usr/bin/git';
}
