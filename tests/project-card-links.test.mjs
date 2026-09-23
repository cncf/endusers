import test from 'node:test';
import assert from 'node:assert/strict';

import { isCncfProjectHref } from '../scripts/lib/project-card-links.mjs';

test('accepts canonical CNCF project URLs', () => {
  assert.equal(
    isCncfProjectHref('https://www.cncf.io/projects/kubernetes/'),
    true,
  );
  assert.equal(isCncfProjectHref('https://cncf.io/projects/helm/'), true);
  assert.equal(isCncfProjectHref('https://www.cncf.io/projects'), true);
  assert.equal(
    isCncfProjectHref('https://www.cncf.io/projects/argo/?ref=architecture'),
    true,
  );
});

test('rejects a foreign host that merely mentions the CNCF project path', () => {
  assert.equal(
    isCncfProjectHref('https://evil.example/r?u=cncf.io/projects/kubernetes/'),
    false,
  );
  assert.equal(
    isCncfProjectHref('https://evil.example/cncf.io/projects/kubernetes/'),
    false,
  );
  assert.equal(
    isCncfProjectHref('https://evil.example/#cncf.io/projects/kubernetes/'),
    false,
  );
});

test('rejects lookalike hosts', () => {
  assert.equal(
    isCncfProjectHref('https://cncf.io.evil.example/projects/x'),
    false,
  );
  assert.equal(isCncfProjectHref('https://notcncf.io/projects/x'), false);
});

test('rejects userinfo that disguises the real host', () => {
  assert.equal(
    isCncfProjectHref('https://www.cncf.io@evil.example/projects/x'),
    false,
  );
});

test('rejects non-https schemes', () => {
  assert.equal(
    isCncfProjectHref('http://www.cncf.io/projects/kubernetes/'),
    false,
  );
  assert.equal(
    isCncfProjectHref('javascript:alert(1)//cncf.io/projects/x'),
    false,
  );
});

test('rejects CNCF URLs outside /projects/', () => {
  assert.equal(isCncfProjectHref('https://www.cncf.io/blog/projects/x'), false);
  assert.equal(
    isCncfProjectHref('https://www.cncf.io/projectsomething'),
    false,
  );
});

test('rejects non-URL and non-string input', () => {
  assert.equal(isCncfProjectHref('not a url'), false);
  assert.equal(isCncfProjectHref(''), false);
  assert.equal(isCncfProjectHref(undefined), false);
  assert.equal(isCncfProjectHref(null), false);
});
