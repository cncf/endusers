import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;

// Runs a script from scripts/ against fixture data by mirroring the repo
// layout in a temp directory. The scripts resolve inputs relative to their
// own import.meta.url (../data, ../src/css, ../static), so a copy placed in
// <tmp>/scripts/ reads fixtures from <tmp>/ instead of the real repo.
// Returns { status, stdout, stderr }.
export function runScriptWithFixtures(scriptName, fixtures = {}) {
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
    const result = spawnSync('node', [join(work, 'scripts', scriptName)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
