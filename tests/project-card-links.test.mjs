import assert from 'node:assert/strict';
import test from 'node:test';
import { isCncfProjectHref } from '../scripts/lib/project-card-links.mjs';

test('accepts the legitimate www.cncf.io project URL', () => {
  assert.equal(
    isCncfProjectHref('https://www.cncf.io/projects/kubernetes/'),
    true,
  );
});

test('accepts a bare cncf.io host', () => {
  assert.equal(isCncfProjectHref('https://cncf.io/projects/kubernetes/'), true);
});

test('rejects a query-string bypass (link injection)', () => {
  assert.equal(
    isCncfProjectHref('https://evil.example/r?u=cncf.io/projects/kubernetes/'),
    false,
  );
});

test('rejects a lookalike host', () => {
  assert.equal(
    isCncfProjectHref('https://cncf.io.evil.example/projects/kubernetes/'),
    false,
  );
});

test('rejects a userinfo bypass', () => {
  assert.equal(
    isCncfProjectHref('https://www.cncf.io@evil.example/projects/kubernetes/'),
    false,
  );
});

test('rejects an http:// downgrade', () => {
  assert.equal(
    isCncfProjectHref('http://www.cncf.io/projects/kubernetes/'),
    false,
  );
});

test('rejects a cncf.io URL outside /projects/', () => {
  assert.equal(isCncfProjectHref('https://www.cncf.io/about/'), false);
});

test('rejects a non-URL string', () => {
  assert.equal(isCncfProjectHref('not a url'), false);
});
