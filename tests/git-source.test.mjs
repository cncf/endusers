// Contract of the two git invocations scripts/lib/git-source.mjs centralizes
// for the collectors, driven against real throwaway repositories: a stub
// would only re-assert the test author's guess at what `git clone --depth 1`
// and `git rev-parse HEAD` answer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cloneShallow, revParseHead } from '../scripts/lib/git-source.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
};

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

// A repository with two commits, so a depth-1 clone is distinguishable from
// a full one, plus a sibling path for the clone to land in.
function makeFixture() {
  const work = mkdtempSync(join(tmpdir(), 'endusers-git-source-'));
  const source = join(work, 'source');
  const destination = join(work, 'clone');
  execFileSync('git', ['init', '-q', '-b', 'main', source], { env: GIT_ENV });
  git(source, ['commit', '-q', '--allow-empty', '-m', 'first']);
  git(source, ['commit', '-q', '--allow-empty', '-m', 'second']);
  return { work, source, destination };
}

test('cloneShallow clones exactly one commit into the destination', () => {
  const { work, source, destination } = makeFixture();
  try {
    // The file:// URL matters: git silently ignores --depth for a plain local
    // path and hardlinks the whole object store instead.
    cloneShallow(`file://${source}`, destination);
    assert.ok(existsSync(join(destination, '.git')));
    assert.equal(git(destination, ['rev-list', '--count', 'HEAD']).trim(), '1');
    assert.equal(
      git(destination, ['rev-parse', '--is-shallow-repository']).trim(),
      'true',
    );
    assert.equal(
      git(destination, ['log', '-1', '--format=%s']).trim(),
      'second',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('cloneShallow lets git talk to the terminal instead of buffering it', () => {
  const { work, destination } = makeFixture();
  try {
    let caught;
    try {
      cloneShallow(`file://${join(work, 'missing')}`, destination);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'a clone of a missing repository must fail');
    // With stdio inherited, nothing is captured on the error; a piped stdio
    // would hand back Buffers and swallow git's progress on a real clone.
    assert.equal(caught.stdout, null);
    assert.equal(caught.stderr, null);
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('revParseHead returns the trimmed HEAD sha of the given directory', () => {
  const { work, source } = makeFixture();
  try {
    const sha = revParseHead(source);
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(sha, git(source, ['rev-parse', 'HEAD']).trim());
    assert.equal(typeof sha, 'string');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('revParseHead reads HEAD of the directory it is pointed at, not the cwd', () => {
  const { work, source, destination } = makeFixture();
  try {
    cloneShallow(`file://${source}`, destination);
    git(source, ['commit', '-q', '--allow-empty', '-m', 'third']);
    assert.notEqual(revParseHead(source), revParseHead(destination));
    assert.equal(
      revParseHead(destination),
      git(destination, ['rev-parse', 'HEAD']).trim(),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('revParseHead throws outside a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'endusers-git-source-plain-'));
  try {
    assert.throws(() => revParseHead(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
