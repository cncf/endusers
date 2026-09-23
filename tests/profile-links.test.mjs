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

// profileUrl resolves its base through `PROFILE_BASES[type] ?? PROFILE_BASES.twitter`.
// Every call site in src/components/CommunityPeople/index.js passes one of the
// three known literals, so the `??` fallback arm had never been evaluated by
// the suite and the branch showed as uncovered.
test('profileUrl falls back to the twitter base for an unrecognised type', () => {
  assert.equal(
    profileUrl('castrojo', 'mastodon'),
    'https://twitter.com/castrojo',
  );
  assert.equal(profileUrl('castrojo'), 'https://twitter.com/castrojo');
  assert.equal(profileUrl('castrojo', null), 'https://twitter.com/castrojo');
});

test('the unrecognised-type fallback still percent-encodes the handle', () => {
  assert.equal(
    profileUrl('../../attacker', 'mastodon'),
    'https://twitter.com/..%2F..%2Fattacker',
  );
});

// Known defect, tracked in #504: PROFILE_BASES is a plain object literal, so
// a `type` naming an Object.prototype member resolves to that inherited value
// instead of missing and falling back. `PROFILE_BASES.constructor` is truthy,
// so `??` does not fire and the function returns a string that is not a URL at
// all — today `profileUrl('castrojo', 'constructor')` yields
// "function Object() { [native code] }castrojo", which would be rendered
// straight into an href. No caller passes an inherited key today, so this is
// latent rather than exploitable; the fix is a null-prototype map or an
// explicit allow-list in src/lib/profile-links.mjs, which is production code.
test(
  'profileUrl treats an inherited Object.prototype key as unrecognised',
  { todo: true },
  () => {
    for (const inherited of ['constructor', 'toString', 'valueOf']) {
      assert.equal(
        profileUrl('castrojo', inherited),
        'https://twitter.com/castrojo',
        `type="${inherited}" must not resolve through Object.prototype`,
      );
    }
  },
);

// websiteUrl guards `!url.hostname` after parsing. For the two protocols it
// allows that guard is unreachable: http/https are WHATWG "special" schemes, so
// the parser either supplies a host or throws. These cases pin the observable
// halves of that contract so the guard is not mistaken for live validation.
test('websiteUrl throws-and-drops rather than accepting an empty http authority', () => {
  assert.equal(websiteUrl('http://'), null);
  assert.equal(websiteUrl('https://?q=1'), null);
  assert.equal(websiteUrl('https://#frag'), null);
});

test('websiteUrl reports the host the URL parser actually derives', () => {
  // An extra slash after the scheme does not produce an empty host: the parser
  // promotes the first path segment to the authority, so the link points at
  // host "etc", not at the origin's /etc/passwd.
  assert.equal(websiteUrl('http:///etc/passwd'), 'http://etc/passwd');
  // A missing slash is normalised the same way rather than rejected.
  assert.equal(websiteUrl('http:/example.test'), 'http://example.test/');
});
