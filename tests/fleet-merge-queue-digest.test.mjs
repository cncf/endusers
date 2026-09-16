import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classify,
  sanitizeMarkdown,
} from '../scripts/fleet-merge-queue-digest.mjs';

test('classify: labels a "security" label as security regardless of title', () => {
  const cls = classify({
    title: 'fix: bump lodash',
    labels: [{ name: 'security' }],
    author: { login: 'someone' },
    body: '',
  });
  assert.equal(cls, 'security');
});

test('classify: recognizes a Dependabot PR that references an advisory as security', () => {
  const cls = classify({
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    labels: [{ name: 'dependencies' }],
    author: { login: 'dependabot[bot]' },
    body: 'This PR fixes GHSA-p6mc-m468-83gw by upgrading lodash.',
  });
  assert.equal(cls, 'security');
});

test('classify: does not misclassify a plain Dependabot bump without an advisory as security', () => {
  const cls = classify({
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    labels: [{ name: 'dependencies' }],
    author: { login: 'dependabot[bot]' },
    body: 'Bumps lodash from 4.17.20 to 4.17.21.',
  });
  assert.equal(cls, 'deps');
});

test('classify: falls back to title text when there are no structured signals', () => {
  const cls = classify({
    title: 'feat: add dark mode toggle',
    labels: [],
    author: { login: 'someone' },
    body: '',
  });
  assert.equal(cls, 'feature');
});

test('classify: a bug-labeled PR is a bugfix even with a generic title', () => {
  const cls = classify({
    title: 'update header component',
    labels: [{ name: 'bug' }],
    author: { login: 'someone' },
    body: '',
  });
  assert.equal(cls, 'bugfix');
});

test('sanitizeMarkdown: escapes table-breaking and formatting characters', () => {
  const result = sanitizeMarkdown('drop `rm -rf /` | *bold* [link](evil)');
  assert.ok(!/(?<!\\)\|/.test(result));
  assert.match(result, /\\\*/);
  assert.match(result, /\\`/);
});

test('sanitizeMarkdown: neutralizes @mentions so they do not ping users/teams', () => {
  const result = sanitizeMarkdown(
    'cc @some-org/some-team please review @octocat',
  );
  assert.ok(!result.includes('@some-org'));
  assert.ok(!result.includes('@octocat'));
  assert.match(result, /@\u200bsome\\-org\/some\\-team/);
});
