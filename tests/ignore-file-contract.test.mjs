// Guards .prettierignore and .markdownlintignore, the two files that decide
// which content `npm run check:format` and `npm run check:markdown` never
// read. Nothing in the suite looks at either one, and every failure mode is
// silent by construction: the checks stay green precisely because the excluded
// content is no longer examined.
//
// Three ways an entry goes wrong without anyone noticing:
//
//   - It goes stale. `docs/architectures/*.md` names generated pages; rename
//     the directory and the pattern matches nothing, so the generated pages at
//     their new path are formatted (and reformatted on every import) while the
//     dead entry still reads as an explanation of why they are not.
//   - A negation is orphaned. `!docs/architectures/index.md` re-includes the
//     one hand-authored page in a generated directory. gitignore semantics
//     only re-include a path some earlier pattern excluded, so if the broader
//     pattern above it is narrowed, the `!` line becomes a no-op that still
//     reads like a guarantee that index.md is formatted.
//   - It arrives undocumented. Every exclusion in both files today is
//     preceded by a comment giving the reason, because "which files are
//     exempt from formatting" is not recoverable from the pattern alone. An
//     entry added without one cannot be audited or retired later.
//
// None of these change the exit status of any check, which is why they need a
// test rather than a reviewer.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const IGNORE_FILES = ['.prettierignore', '.markdownlintignore'];

// Directories that hold no repository content: scanning them is slow and
// nothing in either ignore file is written to address them.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'build',
  '.docusaurus',
  'coverage',
  'test-results',
  'playwright-report',
]);

// Every tracked-looking path in the checkout, repo-relative and separated with
// '/' regardless of platform. Directories are included with a trailing '/'
// stripped so a directory entry such as `blog/` can match one.
function collectPaths(root) {
  const paths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      paths.push(relative(root, absolute).split(sep).join('/'));
      if (entry.isDirectory()) walk(absolute);
    }
  };
  walk(root);
  return paths;
}

const repoPaths = collectPaths(repoRoot);

// Splits an ignore file into its entries, recording for each one whether the
// run of consecutive pattern lines it belongs to is introduced by a comment.
// Grouping by run rather than by line is what lets a single comment cover a
// pattern and the negation that follows it, which is how .prettierignore is
// written today.
export function parseIgnoreFile(source) {
  const entries = [];
  let runIsDocumented = false;
  let inRun = false;
  for (const [index, rawLine] of source.split('\n').entries()) {
    const line = rawLine.trim();
    if (line === '') {
      inRun = false;
      runIsDocumented = false;
      continue;
    }
    if (line.startsWith('#')) {
      if (!inRun) runIsDocumented = true;
      continue;
    }
    inRun = true;
    entries.push({
      pattern: line,
      lineNumber: index + 1,
      documented: runIsDocumented,
    });
  }
  return entries;
}

// Translates one gitignore-style pattern into a matcher over repo-relative
// paths. Only the subset both ignore files actually use is implemented —
// `*`, `**`, `?`, a trailing `/` for directory-only entries, and a leading `/`
// anchoring to the repository root — and an unsupported construct is reported
// rather than silently matching nothing, so a pattern this matcher cannot read
// fails the contract instead of passing it.
export function compilePattern(pattern) {
  const negated = pattern.startsWith('!');
  let body = negated ? pattern.slice(1) : pattern;
  if (body.includes('[')) {
    return { negated, unsupported: 'character class', test: () => false };
  }
  const directoryOnly = body.endsWith('/');
  if (directoryOnly) body = body.slice(0, -1);
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);

  // A pattern containing no slash matches at any depth; one that does is
  // resolved from the repository root, exactly as gitignore defines it.
  const matchesAtAnyDepth = !body.includes('/');

  let expression = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '*') {
      if (body[index + 1] === '*') {
        index += 1;
        if (body[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          // A trailing `**` covers the whole subtree beneath the directory it
          // follows, including the files directly inside it.
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    expression +=
      character === '?' ? '[^/]' : character.replace(/[.+^${}()|\\]/g, '\\$&');
  }

  const prefix = matchesAtAnyDepth ? '(?:.*/)?' : '';
  const regex = new RegExp(`^${prefix}${expression}$`);
  return {
    negated,
    unsupported: null,
    test: (path, isDirectory) => {
      if (directoryOnly && !isDirectory) return false;
      return regex.test(path);
    },
  };
}

// Repo-relative paths one pattern matches, counting a match on a directory as
// covering everything beneath it the way both tools do.
function matchingPaths(pattern, paths, isDirectory) {
  const matcher = compilePattern(pattern);
  if (matcher.unsupported) return [];
  return paths.filter((path) => {
    if (matcher.test(path, isDirectory(path))) return true;
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (matcher.test(segments.slice(0, depth).join('/'), true)) return true;
    }
    return false;
  });
}

// The three detectors below are pure so the tests at the bottom can drive them
// with synthetic input. On a healthy repository every one of them returns an
// empty list, which is exactly why none of their reporting arms would run
// otherwise.

export function staleEntries(entries, paths, isDirectory) {
  return entries
    .filter((entry) => {
      const matcher = compilePattern(entry.pattern);
      if (matcher.unsupported) return true;
      return matchingPaths(entry.pattern, paths, isDirectory).length === 0;
    })
    .map((entry) => `line ${entry.lineNumber}: ${entry.pattern}`);
}

export function orphanedNegations(entries, paths, isDirectory) {
  const orphans = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry.pattern.startsWith('!')) continue;
    const reincluded = matchingPaths(entry.pattern, paths, isDirectory);
    const excludedEarlier = entries
      .slice(0, index)
      .filter((candidate) => !candidate.pattern.startsWith('!'))
      .some((candidate) => {
        const covered = new Set(
          matchingPaths(candidate.pattern, paths, isDirectory),
        );
        return reincluded.some((path) => covered.has(path));
      });
    if (!excludedEarlier) {
      orphans.push(`line ${entry.lineNumber}: ${entry.pattern}`);
    }
  }
  return orphans;
}

export function undocumentedEntries(entries) {
  return entries
    .filter((entry) => !entry.documented)
    .map((entry) => `line ${entry.lineNumber}: ${entry.pattern}`);
}

const directoryPaths = new Set(
  repoPaths.filter((path) => statSync(join(repoRoot, path)).isDirectory()),
);
const isRepoDirectory = (path) => directoryPaths.has(path);

const parsedIgnoreFiles = IGNORE_FILES.map((name) => ({
  name,
  entries: parseIgnoreFile(readFileSync(join(repoRoot, name), 'utf8')),
}));

test('both ignore files exist and declare at least one entry', () => {
  for (const { name, entries } of parsedIgnoreFiles) {
    assert.ok(entries.length > 0, `${name} declares no ignore entries`);
  }
});

test('every ignore entry matches something that exists on disk', () => {
  for (const { name, entries } of parsedIgnoreFiles) {
    assert.deepEqual(
      staleEntries(entries, repoPaths, isRepoDirectory),
      [],
      `${name} excludes paths that no longer exist, so the exclusion is dead and whatever replaced those paths is being checked without anyone having decided that`,
    );
  }
});

test('every negated ignore entry re-includes something an earlier entry excluded', () => {
  for (const { name, entries } of parsedIgnoreFiles) {
    assert.deepEqual(
      orphanedNegations(entries, repoPaths, isRepoDirectory),
      [],
      `${name} negates a pattern nothing above it excludes, so the "!" line has no effect`,
    );
  }
});

test('every run of ignore entries is introduced by a comment', () => {
  for (const { name, entries } of parsedIgnoreFiles) {
    assert.deepEqual(
      undocumentedEntries(entries),
      [],
      `${name} excludes content without recording why; the reason is not recoverable from the pattern`,
    );
  }
});

test('parseIgnoreFile groups a comment with the run of entries it introduces', () => {
  const entries = parseIgnoreFile(
    [
      '# reason',
      'docs/*.md',
      '!docs/index.md',
      '',
      'orphan/',
      '# trailing',
    ].join('\n'),
  );
  assert.deepEqual(
    entries.map((entry) => [entry.pattern, entry.lineNumber, entry.documented]),
    [
      ['docs/*.md', 2, true],
      ['!docs/index.md', 3, true],
      ['orphan/', 5, false],
    ],
  );
});

test('compilePattern implements the gitignore subset both files use', () => {
  const file = () => false;
  const directory = () => true;

  const anyDepth = compilePattern('governance.md');
  assert.equal(anyDepth.test('docs/community/governance.md', false), true);

  const rooted = compilePattern('docs/architectures/*.md');
  assert.equal(rooted.test('docs/architectures/acme.md', false), true);
  assert.equal(rooted.test('docs/architectures/nested/acme.md', false), false);
  assert.equal(rooted.test('other/acme.md', false), false);

  const globstar = compilePattern('docs/architectures/**');
  assert.equal(globstar.test('docs/architectures/nested/acme.md', false), true);

  const dirOnly = compilePattern('blog/');
  assert.equal(dirOnly.test('blog', directory()), true);
  assert.equal(dirOnly.test('blog', file()), false);

  const negation = compilePattern('!docs/architectures/index.md');
  assert.equal(negation.negated, true);
  assert.equal(negation.test('docs/architectures/index.md', false), true);

  assert.equal(compilePattern('docs/[ab].md').unsupported, 'character class');
});

test('the stale-entry detector names an entry matching nothing', () => {
  const paths = ['docs', 'docs/index.md'];
  const isDirectory = (path) => path === 'docs';
  assert.deepEqual(
    staleEntries(parseIgnoreFile('# why\ndocs/*.md'), paths, isDirectory),
    [],
  );
  assert.deepEqual(
    staleEntries(parseIgnoreFile('# why\ngone/*.md'), paths, isDirectory),
    ['line 2: gone/*.md'],
  );
  assert.deepEqual(
    staleEntries(parseIgnoreFile('# why\ndocs/[ab].md'), paths, isDirectory),
    ['line 2: docs/[ab].md'],
  );
});

test('the orphaned-negation detector names a "!" nothing above it excludes', () => {
  const paths = ['docs', 'docs/index.md', 'docs/generated.md'];
  const isDirectory = (path) => path === 'docs';
  assert.deepEqual(
    orphanedNegations(
      parseIgnoreFile('# why\ndocs/*.md\n!docs/index.md'),
      paths,
      isDirectory,
    ),
    [],
  );
  assert.deepEqual(
    orphanedNegations(
      parseIgnoreFile('# why\ndocs/generated.md\n!docs/index.md'),
      paths,
      isDirectory,
    ),
    ['line 3: !docs/index.md'],
  );
});

test('the documentation detector names an entry with no comment above its run', () => {
  assert.deepEqual(undocumentedEntries(parseIgnoreFile('# why\nblog/')), []);
  assert.deepEqual(undocumentedEntries(parseIgnoreFile('blog/')), [
    'line 1: blog/',
  ]);
});
