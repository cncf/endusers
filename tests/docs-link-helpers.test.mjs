// Unit coverage for the markdown readers in ./helpers-docs-links.mjs.
//
// ./docs-contract.test.mjs drives these readers only over the real docs/
// tree, which exercises a fraction of them: docs/ carries no relative link
// with a `#fragment`, so the contract never calls `headingSlugs` at all, and
// every relative link it does carry resolves, so `resolveDocPath` never
// returns null. A regression in either reader would therefore leave the
// contract green while it checked nothing. These tests drive the readers over
// inputs docs/ does not supply, so the contract's own machinery is pinned
// independently of the tree it happens to run against.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  headingSlug,
  headingSlugs,
  readDoc,
  relativeLinks,
  resolveDocPath,
} from './helpers-docs-links.mjs';

function withTempDocs(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'docs-links-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('readDoc splits a terminated frontmatter fence from the body', () => {
  withTempDocs(
    {
      'fenced.md': '---\ntitle: Fenced\nid: one\n---\n\n# Body\n',
      'crlf.md': '---\r\ntitle: Fenced\r\n---\r\n\r\n# Body\r\n',
      'bare.md': '# No frontmatter\n\nJust prose.\n',
      'late.md': 'Prose first.\n\n---\ntitle: Too late\n---\n',
    },
    (root) => {
      const fenced = readDoc(join(root, 'fenced.md'));
      assert.equal(fenced.frontmatter, 'title: Fenced\nid: one');
      assert.equal(fenced.body, '\n\n# Body\n');
      assert.equal(fenced.raw, '---\ntitle: Fenced\nid: one\n---\n\n# Body\n');

      // A CRLF fence must be recognised, or every doc checked out on Windows
      // line endings would look like it had no frontmatter at all.
      assert.equal(readDoc(join(root, 'crlf.md')).frontmatter, 'title: Fenced');

      // No fence: frontmatter is null and the body is the whole file, which is
      // what lets the frontmatter contracts skip the doc rather than fail it.
      const bare = readDoc(join(root, 'bare.md'));
      assert.equal(bare.frontmatter, null);
      assert.equal(bare.body, bare.raw);

      // A `---` fence that does not start the file is a horizontal rule, not
      // frontmatter.
      assert.equal(readDoc(join(root, 'late.md')).frontmatter, null);
    },
  );
});

test('headingSlug reproduces the Docusaurus slug the contract compares against', () => {
  assert.equal(headingSlug('Getting Started'), 'getting-started');
  // Case is folded and runs of whitespace collapse to a single hyphen.
  assert.equal(headingSlug('  Mixed   CASE  Heading  '), 'mixed-case-heading');
  // Code spans contribute their text, not their backticks.
  assert.equal(headingSlug('Run `npm test` first'), 'run-npm-test-first');
  // A linked heading slugs from the link text, discarding the target.
  assert.equal(
    headingSlug('See [the catalog](./catalog.md) now'),
    'see-the-catalog-now',
  );
  // Punctuation is dropped rather than hyphenated, so `a.b` becomes `ab`.
  assert.equal(headingSlug('What is a.b, really?'), 'what-is-ab-really');
  // Hyphens and digits survive.
  assert.equal(headingSlug('End-user members 2024'), 'end-user-members-2024');
  // A heading of nothing but punctuation slugs to the empty string rather
  // than throwing, so a fragment can never accidentally match it.
  assert.equal(headingSlug('???'), '');
});

test('headingSlugs reads every ATX heading level and nothing else', () => {
  const body = [
    '# One',
    'prose that is not a heading',
    '## Two Words   ',
    '###Not a heading without a space',
    '###### Six',
    '####### Seven is not a heading',
    '  # Indented is not a heading',
  ].join('\n');
  assert.deepEqual(headingSlugs(body), ['one', 'two-words', 'six']);
  assert.deepEqual(headingSlugs(''), []);
});

test('relativeLinks keeps the links Docusaurus resolves on disk', () => {
  const body = [
    '[relative](./sibling.md)',
    '[parent](../other/doc.md)',
    '[bare](doc.md)',
    '[fragment of another doc](./sibling.md#a-heading)',
    '[absolute route](/architectures)',
    '[external](https://example.com/x)',
    '[mail](mailto:info@example.com)',
    '[same page](#a-heading)',
    '![image](./diagram.svg)',
  ].join('\n\n');
  assert.deepEqual(relativeLinks(body), [
    './sibling.md',
    '../other/doc.md',
    'doc.md',
    './sibling.md#a-heading',
    './diagram.svg',
  ]);
  assert.deepEqual(relativeLinks('no links here'), []);
});

test('resolveDocPath tries the bare path and both markdown extensions', () => {
  withTempDocs(
    {
      'exact.md': '# Exact\n',
      'extless.mdx': '# Mdx\n',
      'plain.md': '# Plain\n',
      'adir/child.md': '# Child\n',
    },
    (root) => {
      // A path that already names the file wins on the first candidate.
      assert.equal(
        resolveDocPath(join(root, 'exact.md')),
        join(root, 'exact.md'),
      );
      // `./plain` must find plain.md, which is how docs link to each other
      // without an extension.
      assert.equal(resolveDocPath(join(root, 'plain')), join(root, 'plain.md'));
      // .mdx is only reached after .md misses, so it pins the loop order.
      assert.equal(
        resolveDocPath(join(root, 'extless')),
        join(root, 'extless.mdx'),
      );
      // A directory exists but is not a file: the isFile() guard must reject
      // it and keep going rather than returning the directory as a doc.
      assert.equal(resolveDocPath(join(root, 'adir')), null);
      // Nothing at any extension.
      assert.equal(resolveDocPath(join(root, 'missing')), null);
    },
  );
});

test('the readers compose into the fragment check docs/ never exercises', () => {
  withTempDocs(
    {
      'target.md': '---\ntitle: Target\n---\n\n# Known Heading\n\n## Second\n',
      'source.md': [
        '[good](./target.md#known-heading)',
        '[also good](./target#second)',
        '[stale](./target.md#renamed-heading)',
      ].join('\n\n'),
    },
    (root) => {
      const { body } = readDoc(join(root, 'source.md'));
      const broken = [];
      for (const href of relativeLinks(body)) {
        const [path, fragment] = href.split('#');
        const target = resolveDocPath(join(root, path));
        assert.notEqual(target, null, `${href} should resolve`);
        if (!headingSlugs(readDoc(target).body).includes(fragment)) {
          broken.push(href);
        }
      }
      // Exactly the stale fragment is reported: this is the failure the real
      // contract is written to produce and currently never can, because no
      // doc under docs/ carries a fragment link.
      assert.deepEqual(broken, ['./target.md#renamed-heading']);
    },
  );
});
