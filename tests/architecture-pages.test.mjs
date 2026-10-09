import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REPO_AUTHORED_PAGES,
  RESERVED_PAGE_IDS,
  isReservedPageId,
  listArchitecturePages,
  pageCatalogId,
} from '../scripts/lib/architecture-pages.mjs';

function withDocsDir(build, assertions) {
  const work = mkdtempSync(join(tmpdir(), 'endusers-arch-pages-'));
  const docsDir = join(work, 'docs/architectures');
  mkdirSync(docsDir, { recursive: true });
  try {
    build(docsDir);
    assertions(listArchitecturePages(docsDir), docsDir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test('lists top-level markdown pages in sorted order', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'zeiss.md'), '# Zeiss\n');
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md', 'zeiss.md']);
      assert.deepEqual(irregular, []);
    },
  );
});

test('walks nested directories and reports paths relative to docs/architectures', () => {
  withDocsDir(
    (docsDir) => {
      mkdirSync(join(docsDir, 'reports'), { recursive: true });
      writeFileSync(join(docsDir, 'reports/leftover.md'), '# Leftover\n');
    },
    ({ pages }) => {
      assert.deepEqual(pages, ['reports/leftover.md']);
    },
  );
});

test('ignores non-markdown files', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'diagram.svg'), '<svg/>');
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
    },
    ({ pages }) => {
      assert.deepEqual(pages, ['adobe.md']);
    },
  );
});

// Dirent.isFile() is false for a symlink. Returning it separately is what
// lets the caller reject it: skipping it would publish a page nothing reads.
test('reports a symlinked page as irregular rather than as a page', () => {
  withDocsDir(
    (docsDir) => {
      symlinkSync('/etc/hostname', join(docsDir, 'linked.md'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, []);
      assert.deepEqual(irregular, ['linked.md']);
    },
  );
});

test('returns empty lists when the docs directory does not exist', () => {
  const work = mkdtempSync(join(tmpdir(), 'endusers-arch-pages-'));
  try {
    const { pages, irregular } = listArchitecturePages(
      join(work, 'docs/architectures'),
    );
    assert.deepEqual(pages, []);
    assert.deepEqual(irregular, []);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('maps a top-level page to its catalog id', () => {
  assert.equal(pageCatalogId('adobe.md'), 'adobe');
});

test('reports no catalog id for a nested page', () => {
  assert.equal(pageCatalogId('reports/leftover.md'), null);
});

test('reports no catalog id for a non-markdown path', () => {
  assert.equal(pageCatalogId('adobe.txt'), null);
});

// Docusaurus publishes .mdx from the same default `include` as .md, so an
// .mdx page left out of this listing is published without ever reaching the
// active-content gate in validate-architectures.mjs and is never pruned by
// the importer.
test('lists .mdx pages alongside .md pages', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
      writeFileSync(join(docsDir, 'evil.mdx'), '# Evil\n');
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md', 'evil.mdx']);
      assert.deepEqual(irregular, []);
    },
  );
});

test('reports a symlinked .mdx page as irregular rather than skipping it', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
      symlinkSync(join(docsDir, 'adobe.md'), join(docsDir, 'evil.mdx'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md']);
      assert.deepEqual(irregular, ['evil.mdx']);
    },
  );
});

// A symlinked *directory* is the same hole one level up, and it cannot be
// recognised from the entry name: isDirectory() is false for the link, so the
// walk never recurses, and a link named without a page extension used to be
// dropped before the isFile() split was reached. Docusaurus still publishes
// through it — @docusaurus/plugin-content-docs globs docs with
// Globby(include, { cwd, ignore }) and passes no followSymbolicLinks, which
// fast-glob defaults to true — so every page beneath the link shipped without
// ever reaching the active-content scan.
test('reports a symlinked directory as irregular rather than skipping it', () => {
  withDocsDir(
    (docsDir) => {
      const outside = join(docsDir, '..', 'outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'evil.md'), '<div onClick={alert(1)} />\n');
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
      symlinkSync(outside, join(docsDir, 'linked'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md']);
      assert.deepEqual(irregular, ['linked']);
    },
  );
});

test('does not descend into a symlinked directory', () => {
  withDocsDir(
    (docsDir) => {
      const outside = join(docsDir, '..', 'outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'evil.md'), '# Evil\n');
      symlinkSync(outside, join(docsDir, 'linked'));
    },
    ({ pages, irregular }) => {
      assert.equal(pages.includes('linked/evil.md'), false);
      assert.equal(irregular.includes('linked/evil.md'), false);
    },
  );
});

// A link to something Docusaurus does not route publishes nothing, so
// reporting it would be a false failure for every contributor.
test('skips a symlink to a file Docusaurus does not route', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
      symlinkSync(join(docsDir, 'adobe.md'), join(docsDir, 'notes.txt'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md']);
      assert.deepEqual(irregular, []);
    },
  );
});

test('skips a broken symlink that is not a page', () => {
  withDocsDir(
    (docsDir) => {
      writeFileSync(join(docsDir, 'adobe.md'), '# Adobe\n');
      symlinkSync(join(docsDir, 'gone'), join(docsDir, 'dangling'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, ['adobe.md']);
      assert.deepEqual(irregular, []);
    },
  );
});

test('reports a broken symlink that carries a page extension', () => {
  withDocsDir(
    (docsDir) => {
      symlinkSync(join(docsDir, 'gone'), join(docsDir, 'dangling.md'));
    },
    ({ pages, irregular }) => {
      assert.deepEqual(pages, []);
      assert.deepEqual(irregular, ['dangling.md']);
    },
  );
});

test('maps a top-level .mdx page to its catalog id', () => {
  assert.equal(pageCatalogId('evil.mdx'), 'evil');
});

test('exempts only the hand-authored index page', () => {
  assert.ok(REPO_AUTHORED_PAGES.has('index.md'));
  assert.equal(REPO_AUTHORED_PAGES.has('adobe.md'), false);
});

// The exemption above is a hole in the imported-content gate unless the id
// that would land on an exempt page is unavailable to an importer, so the
// reserved set has to be derived from the exempt set rather than listed
// separately: a page added to one must not be forgotten in the other.
test('reserves the catalog id of every repo-authored page', () => {
  assert.deepEqual(
    [...RESERVED_PAGE_IDS].sort(),
    [...REPO_AUTHORED_PAGES].map((page) => page.replace(/\.md$/, '')).sort(),
  );
  assert.ok(RESERVED_PAGE_IDS.has('index'));
});

test('identifies a reserved catalog id', () => {
  assert.equal(isReservedPageId('index'), true);
  assert.equal(isReservedPageId('adobe'), false);
});

// Ids are lowercase slugs by contract, but a record that failed that check
// must not be able to fail this one too and reach the exempt page anyway.
test('identifies a reserved catalog id regardless of case', () => {
  assert.equal(isReservedPageId('Index'), true);
  assert.equal(isReservedPageId('INDEX'), true);
});

test('treats a non-string id as unreserved rather than throwing', () => {
  assert.equal(isReservedPageId(undefined), false);
  assert.equal(isReservedPageId(null), false);
  assert.equal(isReservedPageId(42), false);
});
