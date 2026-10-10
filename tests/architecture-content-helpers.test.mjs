import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstParagraph,
  listValue,
  renderProjectCards,
  splitFrontmatter,
} from '../scripts/lib/architecture-content.mjs';

// scripts/lib/architecture-content.mjs exports six transforms. Two of them --
// cleanMarkdown() and mirrorArtworkUrls() -- have test files of their own.
// The four pinned here had none: they are reached only through
// scripts/import-architectures.mjs and scripts/import-architecture-issue.mjs,
// so every assertion about them was an assertion about a whole importer run.
// They score 100% region coverage that way, which is exactly the problem --
// the lines execute, but nothing states what they are supposed to return, so
// a behavioural change inside them moves no test.
//
// Both callers are unattended: the daily cncf/architecture import and the
// reference-architecture submission issue. Their input is third-party text.

const ARTWORK_SVG =
  'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg';

const card = (header, ...lines) =>
  [`{{< card header="${header}" >}}`, ...lines, '{{< /card >}}'].join('\n');

test('splitFrontmatter parses a leading --- block and trims the body', () => {
  assert.deepEqual(
    splitFrontmatter('---\ntitle: X\ntags:\n  - a\n  - b\n---\n\nBody here\n'),
    { frontmatter: { title: 'X', tags: ['a', 'b'] }, body: 'Body here' },
  );
});

test('text without frontmatter is valid input, not an error', () => {
  // The documented contract: the caller falls back to deriving a title from
  // the body or the id rather than rejecting the page.
  assert.deepEqual(splitFrontmatter('no frontmatter here'), {
    frontmatter: {},
    body: 'no frontmatter here',
  });
});

test('an empty frontmatter block yields {} rather than null', () => {
  // yamlParse('') returns null; the `?? {}` is what keeps the caller's
  // `frontmatter.industries` lookups from throwing on such a page.
  assert.deepEqual(splitFrontmatter('---\n---\nBody'), {
    frontmatter: {},
    body: 'Body',
  });
});

test('listValue normalizes a scalar, a list and an absent value', () => {
  assert.deepEqual(listValue(['a', 'b']), ['a', 'b']);
  assert.deepEqual(listValue('a'), ['a']);
  assert.deepEqual(listValue(undefined), []);
  assert.deepEqual(listValue(null), []);
  assert.deepEqual(listValue(''), []);
});

test('listValue drops a falsy scalar such as 0', () => {
  // The guard is truthiness, not nullishness, so a numeric 0 in frontmatter
  // becomes no entry at all rather than [0]. Pinned because the importers
  // feed the result straight into the catalog's industries/tags arrays.
  assert.deepEqual(listValue(0), []);
  assert.deepEqual(listValue(false), []);
});

test('renderProjectCards builds a card from a Hugo card shortcode', () => {
  assert.equal(
    renderProjectCards(
      card(
        'Helm Chart',
        `![logo](${ARTWORK_SVG})`,
        '[site](https://www.cncf.io/projects/helm/)',
        '**Using since:** 2019',
        '**Current version:** v3.1',
        'Some description text.',
      ),
      'demo',
    ),
    '<CNCFProjectCard name={"Helm Chart"} ' +
      'href={"https://www.cncf.io/projects/helm/"} ' +
      'logo={"/img/cncf-projects/helm-helm-icon-color.svg"} ' +
      'since={"2019"} version={"v3.1"} ' +
      'description={"Some description text."} />',
  );
});

test('a non-CNCF link in a card never becomes the card href', () => {
  // The link inside the shortcode is third-party text. isCncfProjectHref()
  // rejects a host that merely mentions cncf.io in its path, and the href
  // then falls back to the slug derived from the card header -- so a hostile
  // destination cannot be published as the card's own link.
  const rendered = renderProjectCards(
    card('Ev', '[x](https://evil.example/cncf.io/projects/k/)'),
    'demo',
  );
  assert.ok(!rendered.includes('evil.example'), rendered);
  assert.match(rendered, /href=\{"https:\/\/www\.cncf\.io\/projects\/ev\/"\}/);
});

test('a card with no link falls back to a slug of its header', () => {
  assert.equal(
    renderProjectCards(card('Wide Thing', 'Just prose.'), 'demo'),
    '<CNCFProjectCard name={"Wide Thing"} ' +
      'href={"https://www.cncf.io/projects/wide-thing/"} ' +
      'description={"Just prose."} />',
  );
});

test('card text containing a quote cannot end the attribute it is in', () => {
  // Every attribute is an expression attribute, so a `"` in upstream prose is
  // JSON-escaped inside a real string literal instead of terminating a quoted
  // JSX attribute and opening a new prop.
  const rendered = renderProjectCards(
    card('Q', 'Desc with " quote and <tag>.'),
    'demo',
  );
  assert.equal(
    rendered,
    '<CNCFProjectCard name={"Q"} href={"https://www.cncf.io/projects/q/"} ' +
      'description={"Desc with \\" quote and <tag>."} />',
  );
});

test('an unresolvable logo URL is omitted rather than rendered remote', () => {
  const rendered = renderProjectCards(
    card('Off', '![logo](https://evil.example/logo.png)', 'Prose.'),
    'demo',
  );
  assert.ok(!rendered.includes('logo='), rendered);
  assert.ok(!rendered.includes('evil.example'), rendered);
});

test('renderProjectCards rewrites every card and leaves other text alone', () => {
  const body = [
    'Intro paragraph.',
    card('One', 'First.'),
    'Between.',
    card('Two', 'Second.'),
    'Outro.',
  ].join('\n\n');
  const rendered = renderProjectCards(body, 'demo');
  assert.equal(rendered.match(/<CNCFProjectCard /g)?.length, 2);
  assert.ok(!rendered.includes('{{<'), rendered);
  for (const kept of ['Intro paragraph.', 'Between.', 'Outro.']) {
    assert.ok(rendered.includes(kept), rendered);
  }
});

test('body without a card shortcode is returned unchanged', () => {
  assert.equal(renderProjectCards('nothing here', 'demo'), 'nothing here');
});

test('firstParagraph skips headings, images, lists and markup', () => {
  assert.equal(
    firstParagraph('# Heading\n\n![img](x.png)\n\nReal text *here*.'),
    'Real text here.',
  );
});

test('firstParagraph returns the empty string when nothing qualifies', () => {
  // The `?? ''` matters to the caller: the catalog summary is a string field,
  // and a page that is nothing but a heading must still produce one.
  assert.equal(firstParagraph('# only heading'), '');
  assert.equal(firstParagraph(''), '');
});

test('firstParagraph caps the summary at 240 characters', () => {
  const long = `${'x'.repeat(300)}`;
  assert.equal(firstParagraph(long).length, 240);
});
