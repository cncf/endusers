import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  collectCardLogos,
  collectReferences,
  describeRef,
  findBrokenCardLogos,
  findCaseMismatches,
  findEmptyAssets,
  findEscapingReferences,
  findMissingAssets,
  stripUrls,
  walk,
} from './tools/static-references.mjs';

const SOURCES = [{ dir: 'docs', extensions: ['.md', '.mdx'] }];
const DATA_FILES = ['data/members.json'];

// Mirrors the layout tests/static-assets.test.mjs scans: docs/ and a data file
// holding the references, static/ holding the assets they point at. `files`
// maps repo-relative paths to contents; a directory is created for every
// entry, and an empty string produces the zero-byte file the emptiness check
// looks for.
function withFixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-static-refs-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'static'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'members.json'), '{}');
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const staticRoot = join(root, 'static');
    const references = collectReferences({
      repoRoot: root,
      staticRoot,
      sources: SOURCES,
      dataFiles: DATA_FILES,
    });
    return run({ root, staticRoot, references });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('stripUrls removes absolute and protocol-relative URLs', () => {
  assert.equal(
    stripUrls('see https://example.com/img/logo.png now').includes('/img/'),
    false,
  );
  assert.equal(
    stripUrls('src="//cdn.example.com/img/logo.png"').includes('/img/'),
    false,
  );
  assert.equal(stripUrls('![](/img/logo.png)'), '![](/img/logo.png)');
});

test('walk finds matching files recursively and skips other extensions', () => {
  withFixture(
    {
      'docs/a.md': '',
      'docs/nested/b.mdx': '',
      'docs/nested/c.txt': '',
    },
    ({ root }) => {
      const found = walk(join(root, 'docs'), ['.md', '.mdx']).map((file) =>
        file.slice(root.length + 1),
      );
      assert.deepEqual(found.sort(), ['docs/a.md', 'docs/nested/b.mdx']);
    },
  );
});

test('the scan records every referencing file and ignores non-static paths', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'docs/a.md': '![](/img/logo.png) and [route](/community/members)',
      'docs/b.md': '![](/img/logo.png)',
      'data/members.json': '{"logo":"/img/logo.png"}',
    },
    ({ root, references }) => {
      assert.deepEqual([...references.keys()], ['/img/logo.png']);
      assert.deepEqual(references.get('/img/logo.png'), [
        'docs/a.md',
        'docs/b.md',
        'data/members.json',
      ]);
      assert.equal(
        describeRef(references, '/img/logo.png'),
        '/img/logo.png (referenced by docs/a.md, docs/b.md, data/members.json)',
      );
      assert.ok(root);
    },
  );
});

test('a bare top-level directory reference is not treated as an asset', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': 'files live under /img' },
    ({ references }) => {
      assert.deepEqual([...references.keys()], []);
    },
  );
});

test('a remote URL is never mistaken for a local asset reference', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'docs/a.md': '![](https://cdn.example.com/img/absent.png)',
    },
    ({ references }) => {
      assert.deepEqual([...references.keys()], []);
    },
  );
});

test('a reference to an absent file is reported as missing', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': '![](/img/absent.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findMissingAssets(references, staticRoot), [
        '/img/absent.png (referenced by docs/a.md)',
      ]);
    },
  );
});

test('a reference resolving to a directory is reported as not a file', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'static/img/icons/inner.png': 'x',
      'docs/a.md': '![](/img/icons)',
    },
    ({ staticRoot, references }) => {
      assert.deepEqual(findMissingAssets(references, staticRoot), [
        '/img/icons (referenced by docs/a.md) is not a file',
      ]);
    },
  );
});

test('a resolvable reference is not reported as missing', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': '![](/img/logo.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findMissingAssets(references, staticRoot), []);
    },
  );
});

test('a zero-byte asset is reported, and an absent one is left to the missing check', () => {
  withFixture(
    {
      'static/img/empty.png': '',
      'static/img/logo.png': 'x',
      'docs/a.md':
        '![](/img/empty.png) ![](/img/absent.png) ![](/img/logo.png)',
    },
    ({ staticRoot, references }) => {
      assert.deepEqual(findEmptyAssets(references, staticRoot), [
        '/img/empty.png (referenced by docs/a.md)',
      ]);
    },
  );
});

test('a reference whose case differs from the file on disk is reported', () => {
  withFixture(
    { 'static/img/Logo.png': 'x', 'docs/a.md': '![](/img/logo.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findCaseMismatches(references, staticRoot), [
        '/img/logo.png (referenced by docs/a.md) — on disk as "Logo.png"',
      ]);
    },
  );
});

test('a case mismatch in an intermediate directory is reported', () => {
  withFixture(
    {
      'static/img/Icons/logo.png': 'x',
      'docs/a.md': '![](/img/icons/logo.png)',
    },
    ({ staticRoot, references }) => {
      assert.deepEqual(findCaseMismatches(references, staticRoot), [
        '/img/icons/logo.png (referenced by docs/a.md) — on disk as "Icons"',
      ]);
    },
  );
});

test('an exactly-named reference raises no case mismatch', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': '![](/img/logo.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findCaseMismatches(references, staticRoot), []);
    },
  );
});

test('a reference with no counterpart at any case stops without reporting', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': '![](/img/absent.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findCaseMismatches(references, staticRoot), []);
    },
  );
});

test('a reference descending through a file rather than a directory stops', () => {
  withFixture(
    { 'static/img/logo.png': 'x', 'docs/a.md': '![](/img/logo.png/inner.png)' },
    ({ staticRoot, references }) => {
      assert.deepEqual(findCaseMismatches(references, staticRoot), []);
    },
  );
});

test('a reference escaping static/ via traversal is reported', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'docs/a.md': '![](/img/../../secrets.env) ![](/img/logo.png)',
    },
    ({ staticRoot, references }) => {
      assert.deepEqual(findEscapingReferences(references, staticRoot), [
        '/img/../../secrets.env (referenced by docs/a.md)',
      ]);
    },
  );
});

test('CNCFProjectCard logo props are collected from docs and deduplicated', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'docs/a.md':
        '<CNCFProjectCard logo="/img/logo.png" />\n' +
        '<CNCFProjectCard logo="/img/logo.png" />\n' +
        '<CNCFProjectCard logo="relative/img.png" />',
      'docs/b.mdx': "<CNCFProjectCard logo='/img/other.png' />",
    },
    ({ root }) => {
      const logos = collectCardLogos(join(root, 'docs'), root);
      assert.deepEqual(
        [...logos],
        [
          ['/img/logo.png', 'docs/a.md'],
          ['/img/other.png', 'docs/b.mdx'],
        ],
      );
    },
  );
});

test('an unresolvable CNCFProjectCard logo prop is reported', () => {
  withFixture(
    {
      'static/img/logo.png': 'x',
      'static/img/icons/inner.png': 'x',
      'docs/a.md':
        '<CNCFProjectCard logo="/img/absent.png" />\n' +
        '<CNCFProjectCard logo="/img/icons" />\n' +
        '<CNCFProjectCard logo="/img/logo.png" />',
    },
    ({ root, staticRoot }) => {
      const logos = collectCardLogos(join(root, 'docs'), root);
      assert.deepEqual(findBrokenCardLogos(logos, staticRoot), [
        '/img/absent.png (docs/a.md)',
        '/img/icons (docs/a.md) is not a file',
      ]);
    },
  );
});
