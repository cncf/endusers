import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `URL.prototype.pathname` stays percent-encoded, so a checkout whose path
// contains a space (or any other character the URL parser escapes) yields
// `/tmp/space%20dir/repo/` — a directory that does not exist. Every sandbox
// run then dies in cpSync with ENOENT. fileURLToPath performs the decoding
// that turns a file URL back into a filesystem path.
export function resolveRepoRoot(moduleUrl) {
  return fileURLToPath(new URL('..', moduleUrl));
}

const repoRoot = resolveRepoRoot(import.meta.url);

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
