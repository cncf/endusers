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
