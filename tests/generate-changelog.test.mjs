// Coverage for scripts/lib/changelog.mjs and scripts/generate-changelog.mjs.
//
// The pure half (parsing, filtering, grouping, rendering) is driven directly
// with canned `git log` output. The git-facing half (readHistory,
// generateChangelog) is driven against real throwaway repositories —
// including a genuine `--depth 1` clone for the shallow-checkout fallback —
// because the behaviour under test is exactly what git answers, and a stub
// would only re-assert the test author's guess at it.
//
// scripts/generate-changelog.mjs itself is exercised through the shared
// sandbox, which runs the script in a directory that is not a git
// repository: the fallback path the deploy job takes today.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FALLBACK_BODY,
  MAX_ENTRIES,
  escapeLinkText,
  generateChangelog,
  monthHeading,
  parseGitLog,
  readHistory,
  renderChangelog,
  renderPage,
  selectEntries,
  toEntry,
} from '../scripts/lib/changelog.mjs';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
};

function git(dir, args, env = {}) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, ...env },
  });
}

// Builds a repository whose commits have the given subjects at the given
// dates, oldest first, and returns its path.
function makeRepo(commits) {
  const dir = mkdtempSync(join(tmpdir(), 'endusers-changelog-'));
  git(dir, ['init', '-q', '-b', 'main']);
  for (const { subject, date } of commits) {
    git(dir, ['commit', '-q', '--allow-empty', '-m', subject], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

function logOutput(dir) {
  return git(dir, ['log', '--first-parent', '--format=%H%x1f%cI%x1f%s']);
}

test('parseGitLog reads hash, date and subject from the %x1f format', () => {
  const output =
    'abc123\x1f2026-10-05T12:00:00+00:00\x1ffeat: one\n' +
    'def456\x1f2026-09-01T00:00:00+00:00\x1ffix: two\n';
  assert.deepEqual(parseGitLog(output), [
    { hash: 'abc123', date: '2026-10-05T12:00:00+00:00', subject: 'feat: one' },
    { hash: 'def456', date: '2026-09-01T00:00:00+00:00', subject: 'fix: two' },
  ]);
  // The format ends in a newline; a trailing empty line is not an entry.
  assert.equal(parseGitLog('').length, 0);
});

test('parseGitLog keeps a subject that itself contains the separator', () => {
  const [entry] = parseGitLog('abc\x1f2026-10-05T00:00:00Z\x1fa\x1fb\n');
  assert.equal(entry.subject, 'a\x1fb');
});

test('toEntry maps a reader-visible conventional commit to its pull request', () => {
  assert.deepEqual(
    toEntry({
      hash: 'abc',
      date: '2026-10-05T12:00:00Z',
      subject: 'feat(events): add KubeCon NA 2026 schedule (#1369)',
    }),
    {
      month: '2026-10',
      summary: 'add KubeCon NA 2026 schedule',
      pr: '1369',
      hash: 'abc',
    },
  );
});

test('toEntry drops commit types a site visitor cannot see', () => {
  for (const type of ['chore', 'ci', 'test', 'build', 'style', 'refactor']) {
    assert.equal(
      toEntry({
        hash: 'x',
        date: '2026-10-01T00:00:00Z',
        subject: `${type}: bump`,
      }),
      null,
      `${type}: should not render`,
    );
  }
});

test('toEntry keeps a non-conventional subject rather than leaving a hole', () => {
  const entry = toEntry({
    hash: 'deadbeef',
    date: '2026-08-20T00:00:00Z',
    subject: 'Fix the awards table layout',
  });
  assert.equal(entry.summary, 'Fix the awards table layout');
  assert.equal(entry.pr, null);
});

test('selectEntries filters invisible commits', () => {
  const commits = [
    { hash: 'a', date: '2026-10-01T00:00:00Z', subject: 'feat: one (#1)' },
    { hash: 'b', date: '2026-10-01T00:00:00Z', subject: 'chore: bump' },
  ];
  assert.deepEqual(
    selectEntries(commits).map((entry) => entry.hash),
    ['a'],
  );
});

test('monthHeading renders deterministically without Date or Intl', () => {
  assert.equal(monthHeading('2026-10'), 'October 2026');
  assert.equal(monthHeading('2024-01'), 'January 2024');
});

test('renderChangelog groups entries under one heading per month', () => {
  const markdown = renderChangelog([
    { month: '2026-10', summary: 'newer', pr: '2', hash: 'b' },
    { month: '2026-10', summary: 'older', pr: null, hash: 'a' },
    { month: '2026-09', summary: 'last month', pr: '1', hash: 'c' },
  ]);
  assert.equal(
    markdown,
    '## October 2026\n' +
      '\n' +
      '- [newer](https://github.com/cncf/endusers/pull/2)\n' +
      '- [older](https://github.com/cncf/endusers/commit/a)\n' +
      '\n' +
      '## September 2026\n' +
      '\n' +
      '- [last month](https://github.com/cncf/endusers/pull/1)',
  );
});

test('escapeLinkText neutralises markdown and MDX syntax in subjects', () => {
  // Real history carries subjects like
  // "fix(security): scan <style> CSS past a CDATA-hidden </style>"; unescaped,
  // the MDX compiler reads that as JSX and the build fails.
  assert.equal(
    escapeLinkText('scan <style> past </style> and {count} [x] \\y'),
    'scan &lt;style&gt; past &lt;/style&gt; and &#123;count&#125; \\[x\\] \\\\y',
  );
});

test('renderChangelog escapes hostile subjects inside the link text', () => {
  const markdown = renderChangelog([
    {
      month: '2026-10',
      summary: 'scan <style> CSS past a CDATA-hidden </style>',
      pr: '1044',
      hash: 'x',
    },
  ]);
  assert.ok(
    markdown.includes(
      '- [scan &lt;style&gt; CSS past a CDATA-hidden &lt;/style&gt;]' +
        '(https://github.com/cncf/endusers/pull/1044)',
    ),
    markdown,
  );
});

test('renderChangelog caps the page and points at the commit history', () => {
  const entries = Array.from({ length: MAX_ENTRIES + 5 }, (_, index) => ({
    month: '2026-10',
    summary: `change ${index}`,
    pr: String(index + 1),
    hash: 'x',
  }));
  const markdown = renderChangelog(entries);
  assert.equal(
    markdown.match(/^- \[/gm).length,
    MAX_ENTRIES,
    'the page must not grow without bound',
  );
  assert.match(markdown, /Older changes: see the \[commit history\]/);
});

test('renderPage emits Docusaurus frontmatter and the generated-file warning', () => {
  const page = renderPage('BODY');
  assert.match(page, /^---\n/);
  assert.match(page, /title: Changelog/);
  assert.match(page, /sidebar_position: 8/);
  assert.match(page, /Do not edit by hand/);
  assert.match(page, /\nBODY\n$/);
});

test('readHistory returns the first-parent log of a full checkout', () => {
  const dir = makeRepo([
    { subject: 'feat: one (#1)', date: '2026-09-01T00:00:00Z' },
    { subject: 'fix: two (#2)', date: '2026-10-01T00:00:00Z' },
  ]);
  try {
    const history = readHistory(dir);
    assert.ok(history.includes('feat: one (#1)'));
    assert.ok(history.includes('fix: two (#2)'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readHistory returns null for a shallow checkout', () => {
  const full = makeRepo([
    { subject: 'feat: one (#1)', date: '2026-09-01T00:00:00Z' },
    { subject: 'fix: two (#2)', date: '2026-10-01T00:00:00Z' },
  ]);
  const shallow = mkdtempSync(join(tmpdir(), 'endusers-changelog-shallow-'));
  try {
    // The shape of every CI checkout: history exists, but only one commit
    // of it. Rendering that as "the changelog" would be a one-entry fiction.
    // The file:// URL matters: git silently ignores --depth for a plain
    // local path and hardlinks the whole object store instead.
    execFileSync(
      'git',
      ['clone', '-q', '--depth', '1', `file://${full}`, shallow],
      {
        env: GIT_ENV,
      },
    );
    assert.equal(readHistory(shallow), null);
  } finally {
    rmSync(full, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
  }
});

test('readHistory returns null outside a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'endusers-changelog-plain-'));
  try {
    assert.equal(readHistory(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateChangelog renders the history of a full checkout', () => {
  const dir = makeRepo([
    { subject: 'feat: one (#1)', date: '2026-09-01T00:00:00Z' },
    { subject: 'chore: invisible (#2)', date: '2026-09-02T00:00:00Z' },
    { subject: 'fix: three (#3)', date: '2026-10-01T00:00:00Z' },
  ]);
  try {
    const summary = generateChangelog(dir);
    assert.equal(summary, 'wrote 2 changelog entries');
    const page = readFileSync(
      join(dir, 'docs', 'resources', 'changelog.md'),
      'utf8',
    );
    assert.match(page, /## October 2026\n\n- \[three\]\([^)]*\/pull\/3\)/);
    assert.match(page, /## September 2026\n\n- \[one\]\([^)]*\/pull\/1\)/);
    assert.ok(!page.includes('invisible'), 'chore commits must not render');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateChangelog writes the fallback when there is no history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'endusers-changelog-plain-'));
  try {
    const summary = generateChangelog(dir);
    assert.equal(
      summary,
      'wrote changelog fallback (no full git history available)',
    );
    const page = readFileSync(
      join(dir, 'docs', 'resources', 'changelog.md'),
      'utf8',
    );
    assert.ok(page.includes(FALLBACK_BODY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The whole script, the way CI runs it: the sandbox copy sits in a directory
// that is not a git repository, which is also exactly what a shallow deploy
// checkout looks like to git.
test('generate-changelog.mjs writes the fallback page outside a repository', () => {
  const result = runScriptInSandbox({
    script: 'generate-changelog.mjs',
    outputs: ['docs/resources/changelog.md'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /wrote changelog fallback \(no full git history available\)/,
  );
  const page = result.outputs['docs/resources/changelog.md'];
  assert.ok(page, 'expected the changelog page to be written');
  assert.ok(page.includes(FALLBACK_BODY));
  assert.match(page, /title: Changelog/);
});

// The same script against history, end to end: the sandbox cannot offer a
// git repository as the working tree, so this drives the script's own logic
// through the library the script delegates to, using real log output.
test('the lib renders real git log output without massaging', () => {
  const dir = makeRepo([
    {
      subject: 'docs: refresh the awards page (#10)',
      date: '2026-10-03T00:00:00Z',
    },
  ]);
  try {
    const entries = selectEntries(parseGitLog(logOutput(dir)));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].summary, 'refresh the awards page');
    assert.equal(entries[0].pr, '10');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
