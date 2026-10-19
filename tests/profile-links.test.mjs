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

// profileUrl resolves its base through a null-prototype lookup and returns
// null for anything that is not one of the three known networks: a silent
// fallback base would link the handle to the wrong site.
test('profileUrl returns null for an unrecognised type', () => {
  assert.equal(profileUrl('castrojo', 'mastodon'), null);
  assert.equal(profileUrl('castrojo'), null);
  assert.equal(profileUrl('castrojo', null), null);
});

// PROFILE_BASES is a null-prototype map precisely so a `type` naming an
// Object.prototype member (e.g. 'constructor') misses and is rejected
// instead of resolving to an inherited value (#504).
test('profileUrl treats an inherited Object.prototype key as unrecognised', () => {
  for (const inherited of ['constructor', 'toString', 'valueOf']) {
    assert.equal(
      profileUrl('castrojo', inherited),
      null,
      `type="${inherited}" must not resolve through Object.prototype`,
    );
  }
});

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

// The four tests below pin authority-parsing outcomes that websiteUrl()
// already produces but nothing asserted. They matter more than ordinary edge
// cases because of where the value comes from: the free-text "blog" field of a
// third-party GitHub profile, copied verbatim into data/community-people.json
// by scripts/fetch-community-people.mjs and committed unedited by the
// scheduled refresh workflow. Nobody reviews that string before it becomes an
// href, so the only thing standing between it and a misleading link is the URL
// parser this module resolves through.
//
// The tests above cover the disguise websiteUrl() was written for -- an
// explicit userinfo component -- and the protocols it refuses. The authority
// can also be bent without a "@" that survives parsing, and the cases below
// are the three ways that happens plus the one place a bare host is refused.

// Only a backslash separates the host from the rest here, and WHATWG treats a
// backslash as a slash inside a special scheme's authority. The authority
// therefore ends at the backslash, so the link points at the host the reader
// sees *first* -- good.example -- and "@evil.example" lands in the path. That
// is the safe resolution, and it is safe because of how the parser splits the
// string rather than because of anything this module checks: the userinfo
// guard never fires, because by the time it runs `username` is already empty.
//
// So this is a property that a refactor can silently invert. Replacing the
// `new URL()` resolution in applyDefaultScheme() with a manual split on "@",
// or any hand-rolled host extraction, would read the trailing label as the
// host and hand the reader a link to evil.example wearing good.example's name,
// with every existing test in this file still green.
test('websiteUrl resolves a backslash authority to the leading visible host', () => {
  assert.equal(
    websiteUrl('good.example\\@evil.example'),
    'https://good.example/@evil.example',
  );
  assert.equal(
    websiteUrl('https://good.example\\@evil.example'),
    'https://good.example/@evil.example',
  );
  // Without the "@" the same split applies, so the trailing labels cannot
  // promote themselves into the host either.
  assert.equal(
    websiteUrl('good.example\\.evil.example'),
    'https://good.example/.evil.example',
  );
});

// A schemeless value is only resolved against https when SCHEME_PATTERN finds
// no scheme on it, and that pattern -- /^[a-z][a-z0-9+.-]*:/i -- allows dots,
// so "example.test:" matches it as a scheme. "example.test:8080" is therefore
// parsed as given rather than as a host with a port, yielding protocol
// "example.test:", which is outside the allowed http/https set and drops the
// link.
//
// Pinned because the outcome is easy to mistake for a port ban and "fix" by
// widening the allowed protocols, which would admit every other scheme a
// dotted prefix can spell. A port is not refused -- it survives whenever the
// value carries a scheme of its own -- so the second half of this test records
// where the boundary actually sits.
test('websiteUrl drops a schemeless host whose port reads as a scheme', () => {
  assert.equal(websiteUrl('example.test:8080'), null);
  assert.equal(websiteUrl('example.test:8080/blog'), null);
  assert.equal(websiteUrl('example.test:'), null);
  // The same authority keeps its port once the value says which scheme it is.
  assert.equal(
    websiteUrl('https://example.test:8080'),
    'https://example.test:8080/',
  );
});

// "gооd.example" here carries two Cyrillic о (U+043E) in place of the Latin
// letters. The parser converts the host to its punycode form, so the href the
// anchor carries is xn--gd-fmca.example and not the Latin-looking original:
// the encoded authority is what any later host comparison or display would
// have to reckon with. websiteUrl() does not reject homographs -- it has no
// allowlist to reject them against -- and recording that it normalises rather
// than rejects keeps the behaviour from being assumed either way.
test('websiteUrl emits the punycode host for a non-ASCII authority', () => {
  assert.equal(websiteUrl('gооd.example'), 'https://xn--gd-fmca.example/');
  assert.equal(
    websiteUrl('https://gооd.example'),
    'https://xn--gd-fmca.example/',
  );
});

// The two halves disagree, and both are the parser's doing rather than the
// trim() in websiteUrl(), which only removes ASCII whitespace. A trailing NUL
// is a C0 control the parser strips, leaving an ordinary host; a NUL inside
// the host is a forbidden host code point, which makes the parse throw and
// takes the catch in checkUrl(). Pinned so neither is mistaken for the other:
// the first shows a control character cannot smuggle itself into an href, the
// second shows a mangled host is dropped instead of being repaired.
test('websiteUrl strips a trailing NUL but drops one inside the host', () => {
  assert.equal(websiteUrl('evil.example\u0000'), 'https://evil.example/');
  assert.equal(websiteUrl('exa\u0000mple.test'), null);
});
