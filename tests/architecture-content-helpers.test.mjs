import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findRelativeDestinations,
  firstParagraph,
} from '../scripts/lib/architecture-content.mjs';

// firstParagraph() is reached only through scripts/import-architecture-issue.mjs,
// so without these pins every assertion about it would be an assertion about a
// whole importer run: the lines execute, but nothing states what they return.

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

test('firstParagraph flattens an inline link to its text, dropping the URL', () => {
  assert.equal(
    firstParagraph('Built with [MLFlow](https://mlflow.org/) tracking.'),
    'Built with MLFlow tracking.',
  );
});

test('firstParagraph cuts a long paragraph on the last sentence boundary, not mid-word', () => {
  const sentence = 'This describes the deployment in full. ';
  const body =
    sentence.repeat(7) + 'Trailing words that never close a sentence';
  const result = firstParagraph(body);
  assert.ok(result.length <= 240);
  assert.match(result, /\.$/);
  assert.ok(!result.endsWith('Trailing words that never close a sentence'));
});

const PARAGRAPHS = [
  [
    'splits paragraphs on a blank line that carries whitespace',
    '# H\n  \nText',
    'Text',
  ],
  [
    'trims a part before testing its first character',
    '# H\n\n  # Sub\n\nReal',
    'Real',
  ],
  [
    'rejects only a leading markup character, not one mid-sentence',
    'Uses GitOps - and <tools> | more',
    'Uses GitOps - and <tools> | more',
  ],
  ['collapses a whitespace run to one space', 'a  b\n\tc', 'a b c'],
];

for (const [label, body, expected] of PARAGRAPHS) {
  test(`firstParagraph ${label}`, () => {
    assert.equal(firstParagraph(body), expected);
  });
}

test('findRelativeDestinations reports only relative paths, by line', () => {
  const body = [
    '![Diagram](./images/diagram.svg)',
    '[Notes](notes.md) and [Up](../submit/)',
    '',
    '[ref]: images/flow.png',
    '',
    '![Published](/img/architectures/acme/diagram.svg)',
    '[Site](https://example.com) [Mail](mailto:a@example.com) [Top](#top) [Self]()',
    '',
    '```',
    '![Code](./in-code.svg)',
    '```',
  ].join('\n');
  assert.deepEqual(findRelativeDestinations(body), [
    { line: 1, url: './images/diagram.svg' },
    { line: 2, url: 'notes.md' },
    { line: 2, url: '../submit/' },
    { line: 4, url: 'images/flow.png' },
  ]);
});
