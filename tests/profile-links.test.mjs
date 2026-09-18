import assert from 'node:assert/strict';
import test from 'node:test';
import { profileUrl, websiteUrl } from '../src/lib/profile-links.mjs';

test('websiteUrl keeps an explicit https URL', () => {
  assert.equal(
    websiteUrl('https://www.alolitasharma.com'),
    'https://www.alolitasharma.com/',
  );
});

test('websiteUrl keeps an explicit http URL rather than dropping the link', () => {
  assert.equal(websiteUrl('http://wangxu.me'), 'http://wangxu.me/');
});

test('websiteUrl resolves a bare host against https', () => {
  assert.equal(websiteUrl('abebars.io'), 'https://abebars.io/');
});

test('websiteUrl resolves a bare host with a path against https', () => {
  assert.equal(websiteUrl('example.test/blog'), 'https://example.test/blog');
});

test('websiteUrl rejects a userinfo authority that disguises the real host', () => {
  assert.equal(websiteUrl('www.cncf.io@attacker.example/login'), null);
  assert.equal(websiteUrl('https://www.cncf.io@attacker.example/login'), null);
});

test('websiteUrl rejects protocols outside http and https', () => {
  assert.equal(websiteUrl('javascript:alert(1)'), null);
  assert.equal(websiteUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(websiteUrl('file:///etc/passwd'), null);
});

test('websiteUrl does not treat a non-http scheme as a hostname', () => {
  // The previous substring guard concatenated this onto "https://".
  assert.equal(websiteUrl('vbscript:msgbox(1)'), null);
});

test('websiteUrl rejects unparsable and empty values', () => {
  assert.equal(websiteUrl('https://'), null);
  assert.equal(websiteUrl('   '), null);
  assert.equal(websiteUrl(''), null);
  assert.equal(websiteUrl(null), null);
  assert.equal(websiteUrl(undefined), null);
  assert.equal(websiteUrl(42), null);
});

test('websiteUrl trims surrounding whitespace', () => {
  assert.equal(websiteUrl('  example.test  '), 'https://example.test/');
});

test('profileUrl builds the expected base for each network', () => {
  assert.equal(profileUrl('castrojo', 'github'), 'https://github.com/castrojo');
  assert.equal(
    profileUrl('castrojo', 'linkedin'),
    'https://www.linkedin.com/in/castrojo',
  );
  assert.equal(
    profileUrl('castrojo', 'twitter'),
    'https://twitter.com/castrojo',
  );
});

test('profileUrl percent-encodes a handle so it cannot add path segments', () => {
  assert.equal(
    profileUrl('../../attacker', 'github'),
    'https://github.com/..%2F..%2Fattacker',
  );
  assert.equal(
    profileUrl('a b?c=d', 'twitter'),
    'https://twitter.com/a%20b%3Fc%3Dd',
  );
});

test('profileUrl returns null for a missing handle', () => {
  assert.equal(profileUrl('', 'github'), null);
  assert.equal(profileUrl(null, 'linkedin'), null);
  assert.equal(profileUrl(undefined, 'twitter'), null);
});
