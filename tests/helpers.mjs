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

// Runs a script from scripts/ against fixture data by mirroring the repo
// layout in a temp directory. The scripts resolve inputs relative to their
// own import.meta.url (../data, ../src/css, ../static), so a copy placed in
// <tmp>/scripts/ reads fixtures from <tmp>/ instead of the real repo.
// Returns { status, stdout, stderr, files }.
//
// options.args   — extra argv entries passed to the script (e.g. ['--fix']).
// options.readBack — repo-relative paths whose contents are captured after the
// run and returned in `files`; a path the script deleted or never wrote is
// reported as `null`. This is how write-mode behaviour is asserted, since the
// sandbox is removed before this function returns.
export function runScriptWithFixtures(scriptName, fixtures = {}, options = {}) {
  const { args = [], readBack = [] } = options;
  const work = mkdtempSync(join(tmpdir(), 'endusers-test-'));
  try {
    mkdirSync(join(work, 'scripts'), { recursive: true });
    cpSync(
      join(repoRoot, 'scripts', scriptName),
      join(work, 'scripts', scriptName),
    );
    // Scripts import shared modules from scripts/lib/ — mirror it so the
    // temp copy resolves the same relative imports.
    cpSync(join(repoRoot, 'scripts', 'lib'), join(work, 'scripts', 'lib'), {
      recursive: true,
    });
    for (const [relativePath, content] of Object.entries(fixtures)) {
      const target = join(work, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const result = spawnSync(
      'node',
      [join(work, 'scripts', scriptName), ...args],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const files = {};
    for (const relativePath of readBack) {
      const target = join(work, relativePath);
      files[relativePath] = existsSync(target)
        ? readFileSync(target, 'utf8')
        : null;
    }
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      files,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
