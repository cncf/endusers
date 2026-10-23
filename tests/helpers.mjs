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

const STRYKER_NAMESPACE = process.env.STRYKER_NAMESPACE || '__stryker__';

// Only true under Stryker, which preloads a hook that creates this object
// before any test runs. Outside a mutation run the spawned scripts stay
// exactly as they were: no extra preload, no extra environment entry.
function strykerNamespace() {
  return globalThis[STRYKER_NAMESPACE];
}

const childCoverageHook = fileURLToPath(
  new URL('./tools/stryker-child-coverage.cjs', import.meta.url),
);

// Folds one spawned script's mutant counters into this process's, so Stryker
// attributes them to the test file that ran the script. The tap runner never
// sets `currentTestId`, so the child's `static` bucket and ours describe the
// same test file and add together directly.
export function mergeStrykerChildCoverage(payload) {
  const ns = strykerNamespace();
  if (!ns || !payload) return;
  const { mutantCoverage, hitCount } = payload;
  if (mutantCoverage) {
    const coverage = (ns.mutantCoverage ??= { static: {}, perTest: {} });
    for (const [id, count] of Object.entries(mutantCoverage.static ?? {})) {
      coverage.static[id] = (coverage.static[id] ?? 0) + count;
    }
    for (const [testId, counts] of Object.entries(
      mutantCoverage.perTest ?? {},
    )) {
      const bucket = (coverage.perTest[testId] ??= {});
      for (const [id, count] of Object.entries(counts)) {
        bucket[id] = (bucket[id] ?? 0) + count;
      }
    }
  }
  // The child enforces its own hit limit and exits; carrying the count back
  // keeps a mutant that loops across several spawns visible to Stryker's
  // limit rather than letting each child start again from zero.
  if (typeof hitCount === 'number' && typeof ns.hitCount === 'number') {
    ns.hitCount += hitCount;
  }
}

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
// options.symlinks — repo-relative link paths mapped to their link targets,
// created after the fixture files so a link may point at one of them.
// options.setup — called with the sandbox root once fixtures and symlinks are
// in place, for filesystem entries `fixtures` cannot express (a FIFO, a
// socket, a mode change). Runs before the script is spawned.
export function runScriptWithFixtures(scriptName, fixtures = {}, options = {}) {
  const { args = [], readBack = [], symlinks = {}, setup = null } = options;
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
    // The mirrored modules import parser packages by bare name.
    symlinkSync(join(repoRoot, 'node_modules'), join(work, 'node_modules'));
    for (const [relativePath, content] of Object.entries(fixtures)) {
      const target = join(work, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    for (const [relativePath, linkTarget] of Object.entries(symlinks)) {
      const link = join(work, relativePath);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(linkTarget, link);
    }
    if (setup) setup(work);
    // Kept outside `work` so a script that walks the sandbox never sees it.
    const childCoverageFile = strykerNamespace()
      ? `${work}.stryker-coverage.json`
      : null;
    const result = spawnSync(
      'node',
      [
        ...(childCoverageFile ? ['-r', childCoverageHook] : []),
        join(work, 'scripts', scriptName),
        ...args,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childCoverageFile
          ? { ...process.env, STRYKER_CHILD_COVERAGE_FILE: childCoverageFile }
          : process.env,
      },
    );
    if (childCoverageFile) {
      if (existsSync(childCoverageFile)) {
        mergeStrykerChildCoverage(
          JSON.parse(readFileSync(childCoverageFile, 'utf8')),
        );
      }
      rmSync(childCoverageFile, { force: true });
    }
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
