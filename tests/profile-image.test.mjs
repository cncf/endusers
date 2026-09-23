import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstAllowedImageUrl,
  isAllowedImageHost,
  profileImageUrl,
} from '../scripts/lib/profile-image.mjs';

test('accepts https images on GitHub and CNCF hosts', () => {
  for (const url of [
    'https://raw.githubusercontent.com/cncf/people/main/images/ada.jpg',
    'https://avatars.githubusercontent.com/u/1?v=4',
    'https://github.com/ada.png',
    'https://www.cncf.io/wp-content/uploads/ada.jpg',
    'https://cncf.io/ada.png',
  ]) {
    assert.equal(profileImageUrl(url), new URL(url).href, url);
  }
});

test('rejects hosts outside the allowlist', () => {
  assert.equal(profileImageUrl('https://images.example/ada.png'), null);
  // A suffix match alone must not admit a lookalike host.
  assert.equal(profileImageUrl('https://evil-cncf.io/ada.png'), null);
  assert.equal(profileImageUrl('https://cncf.io.evil.example/ada.png'), null);
  assert.equal(
    profileImageUrl('https://githubusercontent.com.evil.example/ada.png'),
    null,
  );
});

test('rejects non-https schemes', () => {
  assert.equal(profileImageUrl('http://github.com/ada.png'), null);
  assert.equal(profileImageUrl('javascript:alert(1)'), null);
  assert.equal(profileImageUrl('data:image/svg+xml;base64,AAAA'), null);
  assert.equal(profileImageUrl('//github.com/ada.png'), null);
});

test('rejects a userinfo component that disguises the real host', () => {
  assert.equal(
    profileImageUrl('https://www.cncf.io@evil.example/ada.png'),
    null,
  );
  assert.equal(
    profileImageUrl('https://github.com:token@evil.example/ada.png'),
    null,
  );
});

test('rejects empty, blank and non-string values', () => {
  for (const value of ['', '   ', null, undefined, 42, {}, ['x']]) {
    assert.equal(profileImageUrl(value), null, String(value));
  }
});

test('isAllowedImageHost matches subdomains of cncf.io only', () => {
  assert.ok(isAllowedImageHost('cncf.io'));
  assert.ok(isAllowedImageHost('WWW.CNCF.IO'));
  assert.ok(!isAllowedImageHost('cncf.io.evil.example'));
  assert.ok(!isAllowedImageHost(''));
  assert.ok(!isAllowedImageHost(undefined));
});

test('firstAllowedImageUrl returns the first passing candidate', () => {
  assert.equal(
    firstAllowedImageUrl(
      'https://images.example/upstream.png',
      'http://github.com/cached.png',
      'https://github.com/fallback.png',
      'https://github.com/derived.png',
    ),
    'https://github.com/fallback.png',
  );
});

test('firstAllowedImageUrl returns an empty string when nothing passes', () => {
  assert.equal(
    firstAllowedImageUrl(undefined, '', 'ftp://github.com/a.png'),
    '',
  );
});
