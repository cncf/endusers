// The swizzled theme Footer renders on every page of the site, yet it is the
// only component under src/theme/ that no test imports: it does not appear in
// the `node --test --experimental-test-coverage` report at all, because no
// test ever loads it. That makes its whole contract unguarded — the six
// social links, the CNCF wordmark, the embedded ProjectsBorn strip and the
// copyright line are all assembled from a literal array and a `new Date()`
// call with nothing asserting the result.
//
// Footer calls no stateful hooks (only the stubbed `useBaseUrl`), so it can be
// invoked directly and its returned element tree walked, exactly as
// tests/cncf-project-card.test.mjs does.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { importSource } from './helpers-jsx.mjs';
import Link from './tools/docusaurus-stubs/Link.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const { default: Footer } = await importSource('src/theme/Footer/index.js');
const { default: ProjectsBorn } = await importSource(
  'src/components/ProjectsBorn/index.js',
);

const SOURCE_PATH = new URL('../src/theme/Footer/index.js', import.meta.url);

// Anchors that carry a `title` are the icon links; the wordmark and the
// "All CNCF Sites" button are identified separately below.
function socialAnchors(tree) {
  return findAllByType(tree, 'a').filter((anchor) => anchor.props.title);
}

test('the footer renders a <footer> landmark as its root', () => {
  const tree = Footer();
  assert.equal(tree.type, 'footer');
});

test('the CNCF wordmark is resolved through useBaseUrl and is not decorative', () => {
  const img = findByType(Footer(), 'img');
  assert.ok(img, 'expected the CNCF wordmark <img>');
  assert.equal(img.props.src, '/img/cncf_logo_white.svg');
  assert.ok(
    img.props.alt,
    'the wordmark is the only content of its anchor, so alt must name it',
  );
});

test('the wordmark anchor points at cncf.io and severs window.opener', () => {
  const anchor = findAllByType(Footer(), 'a').find((candidate) =>
    findByType(candidate, 'img'),
  );
  assert.ok(anchor, 'expected the wordmark to be wrapped in an anchor');
  assert.equal(anchor.props.href, 'https://www.cncf.io/');
  assert.equal(anchor.props.target, '_blank');
  assert.match(anchor.props.rel, /\bnoopener\b/);
});

test('the "All CNCF Sites" button links out through Docusaurus <Link>', () => {
  const links = findAllByType(Footer(), Link);
  assert.equal(links.length, 1, 'expected exactly one <Link> in the footer');
  const [link] = links;
  assert.match(textOf(link), /All CNCF Sites/);
  assert.equal(link.props.to, 'https://www.cncf.io/all-cncf/');
});

test('every social channel is rendered as its own icon link', () => {
  const anchors = socialAnchors(Footer());
  const names = anchors.map((anchor) => anchor.props.title);
  assert.deepEqual(names, [
    'X',
    'GitHub',
    'LinkedIn',
    'YouTube',
    'Flickr',
    'Slack',
  ]);
});

test('each icon link carries an accessible name, because its only child is an svg', () => {
  for (const anchor of socialAnchors(Footer())) {
    assert.ok(
      findByType(anchor, 'svg'),
      `${anchor.props.title}: expected an inline <svg> icon`,
    );
    assert.equal(
      textOf(anchor),
      '',
      `${anchor.props.title}: the icon contributes no text, so the title ` +
        'attribute is the only accessible name and must not be dropped',
    );
    assert.ok(
      anchor.props.title.trim(),
      'an icon link with a blank title is unreachable by name',
    );
  }
});

test('no two icon links share a title or a destination', () => {
  const anchors = socialAnchors(Footer());
  const titles = anchors.map((anchor) => anchor.props.title);
  const hrefs = anchors.map((anchor) => anchor.props.href);
  assert.equal(new Set(titles).size, titles.length, 'duplicate icon titles');
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate icon hrefs');
});

test('every icon link is an https URL and opens in a new tab safely', () => {
  for (const anchor of socialAnchors(Footer())) {
    assert.match(
      anchor.props.href,
      /^https:\/\//,
      `${anchor.props.title}: footer links are mixed content unless https`,
    );
    assert.equal(anchor.props.target, '_blank');
    assert.match(
      anchor.props.rel,
      /\bnoopener\b/,
      `${anchor.props.title}: target="_blank" without noopener hands the ` +
        'opened page a window.opener handle back to this site',
    );
  }
});

test('icon links only reach CNCF-operated destinations', () => {
  // The footer is on every page; a typo or a hijacked handle here is a
  // site-wide outbound link. Pin the host of each channel.
  const expected = new Map([
    ['X', 'https://x.com/cloudnativefdn'],
    ['GitHub', 'https://github.com/cncf'],
    [
      'LinkedIn',
      'https://www.linkedin.com/company/cloud-native-computing-foundation/',
    ],
    ['YouTube', 'https://www.youtube.com/c/cloudnativefdn'],
    ['Flickr', 'https://www.flickr.com/photos/143247548@N03/albums'],
    ['Slack', 'https://slack.cncf.io/'],
  ]);
  for (const anchor of socialAnchors(Footer())) {
    assert.equal(
      anchor.props.href,
      expected.get(anchor.props.title),
      `${anchor.props.title}: unexpected destination`,
    );
  }
});

test('each icon link is keyed, so React can reorder the list', () => {
  for (const anchor of socialAnchors(Footer())) {
    assert.ok(anchor.key, 'expected a stable key on each icon link');
  }
});

test('the ProjectsBorn strip is embedded in its compact form', () => {
  const strip = findByType(Footer(), ProjectsBorn);
  assert.ok(strip, 'expected the ProjectsBorn strip in the footer');
  assert.equal(
    strip.props.compact,
    true,
    'the footer strip must stay compact; the full form belongs on the page',
  );
});

test('the copyright line is read from the clock, not pinned to a build year', () => {
  const text = textOf(Footer());
  assert.match(text, new RegExp(`©\\s*${new Date().getFullYear()}`));
  assert.match(text, /Cloud Native Computing Foundation/);
  assert.match(text, /CC BY 4\.0/);
});

test('the footer source hard-codes no calendar year', () => {
  // A literal year would pass the assertion above for the rest of this year
  // and then silently go stale on 1 January.
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const copyright = source.slice(source.indexOf('bottomRow'));
  assert.doesNotMatch(
    copyright,
    /\b(19|20)\d{2}\b/,
    'the copyright line must interpolate the current year',
  );
});

test('the footer exposes no interactive control other than its links', () => {
  // Everything in the footer navigates. A button here would be dead markup in
  // a server-rendered theme component that ships no handler.
  const interactive = [...walkElements(Footer())].filter((element) =>
    ['button', 'input', 'form'].includes(element.type),
  );
  assert.deepEqual(interactive, []);
});
