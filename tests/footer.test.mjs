// The swizzled theme Footer renders on every page of the site, yet it is the
// only component under src/theme/ that no test imports: it does not appear in
// the `node --test --experimental-test-coverage` report at all, because no
// test ever loads it. That makes its whole contract unguarded — the six
// social links, the CNCF wordmark and the copyright line are all assembled
// from a literal array and a `new Date()` call with nothing asserting the result.
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
  const button = links.find((link) => /All CNCF Sites/.test(textOf(link)));
  assert.ok(button, 'expected an "All CNCF Sites" <Link> in the footer');
  assert.equal(button.props.to, 'https://www.cncf.io/all-cncf/');
});

// The public feedback loop: the footer is the one piece of chrome on every
// page, so it carries the "what changed" page and the content-issue report
// form where a visitor can find them without knowing the repository exists.
test('the footer links to the changelog through Docusaurus <Link>', () => {
  const links = findAllByType(Footer(), Link);
  const changelog = links.find((link) => textOf(link) === 'Changelog');
  assert.ok(changelog, 'expected a "Changelog" <Link> in the footer');
  // The stubbed useBaseUrl returns its input unchanged; in the shipped build
  // this resolves under the deployed baseUrl.
  assert.equal(changelog.props.to, '/community/changelog');
});

test('the footer links to the content-issue form, guarded against tabnabbing', () => {
  const report = findAllByType(Footer(), 'a').find(
    (anchor) => textOf(anchor) === 'Report a content issue',
  );
  assert.ok(report, 'expected a "Report a content issue" anchor');
  assert.equal(
    report.props.href,
    'https://github.com/cncf/endusers/issues/new?template=content-issue.yml',
  );
  // The preselected template is the contract
  // tests/issue-template-contract.test.mjs pins from the other side; a
  // rename in either place must fail one of the two suites.
  assert.equal(report.props.target, '_blank');
  assert.match(report.props.rel, /\bnoopener\b/);
  assert.match(report.props.rel, /\bnoreferrer\b/);
});

// Audience signposting (#1407, ADR 0004): a reader who landed here looking to
// contribute to a CNCF project gets a site-wide pointer to the contributor
// portal from the one piece of chrome on every page.
test('the footer signposts contributors to contribute.cncf.io', () => {
  const signpost = findAllByType(Footer(), 'a').find(
    (anchor) => textOf(anchor) === 'Contribute to a project',
  );
  assert.ok(signpost, 'expected a "Contribute to a project" anchor');
  assert.equal(signpost.props.href, 'https://contribute.cncf.io/');
  assert.equal(signpost.props.target, '_blank');
  assert.match(signpost.props.rel, /\bnoopener\b/);
  assert.match(signpost.props.rel, /\bnoreferrer\b/);
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
test('the ProjectsBorn component is not rendered in the footer', () => {
  const strip = findByType(Footer(), ProjectsBorn);
  assert.equal(
    strip,
    undefined,
    'ProjectsBorn must not be rendered in the global footer',
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
