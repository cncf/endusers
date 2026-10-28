import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTHORED_KEYS,
  RECORD_KEYS,
  assetUrls,
  catalogRecords,
  collectArchitectureRecords,
  listPageAssets,
  recordFromFrontMatter,
  serializeCatalog,
  splitFrontMatter,
} from '../scripts/lib/architecture-frontmatter.mjs';

function withDocsDir(files, run) {
  const docsDir = mkdtempSync(join(tmpdir(), 'endusers-frontmatter-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(docsDir, relativePath);
      if (content === null) mkdirSync(target, { recursive: true });
      else {
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, content);
      }
    }
    return run(docsDir);
  } finally {
    rmSync(docsDir, { recursive: true, force: true });
  }
}

const page = (fields) =>
  `---\ntitle: Acme\narchitecture:\n${Object.entries(fields)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n')}\n---\n\n# Acme\n`;

test('the authored keys are the record keys minus the derived ones', () => {
  assert.deepEqual(
    AUTHORED_KEYS,
    RECORD_KEYS.filter((key) => !['id', 'title', 'assets'].includes(key)),
  );
});

// The closing delimiter's own line break belongs to the block, so the body
// starts on the line after it and line numbers in the content scan line up.
test('splitFrontMatter returns the mapping and the body after the block', () => {
  const { data, body } = splitFrontMatter(
    '---\ntitle: Acme\narchitecture:\n  organization: Acme Corp\n---\n\n# Acme\n',
  );
  assert.deepEqual(data, {
    title: 'Acme',
    architecture: { organization: 'Acme Corp' },
  });
  assert.equal(body, '\n# Acme\n');
});

test('splitFrontMatter accepts CRLF line endings around the block', () => {
  const { data, body } = splitFrontMatter('---\r\ntitle: Acme\r\n---\r\nbody');
  assert.deepEqual(data, { title: 'Acme' });
  assert.equal(body, 'body');
});

test('splitFrontMatter reads a block that ends at the end of the file', () => {
  assert.deepEqual(splitFrontMatter('---\ntitle: Acme\n---'), {
    data: { title: 'Acme' },
    body: '',
  });
});

// Docusaurus only reads front matter at the very start of the file; a block
// further down is body text, and treating it as metadata would read a page
// Docusaurus publishes without any.
test('splitFrontMatter ignores a block that does not open the file', () => {
  const content = '# Acme\n---\ntitle: Acme\n---\n';
  assert.deepEqual(splitFrontMatter(content), { data: null, body: content });
});

test('splitFrontMatter keeps the whole content as body when there is no block', () => {
  assert.deepEqual(splitFrontMatter('# Acme\n'), {
    data: null,
    body: '# Acme\n',
  });
});

// Docusaurus would reject these pages at build time, but the content gate must
// still scan their bodies, so the body is returned without the block.
for (const [label, block] of [
  ['invalid YAML', 'title: [unclosed'],
  ['a list', '- a'],
  ['a scalar', 'text'],
  ['empty', ''],
]) {
  test(`splitFrontMatter yields no data when the block is ${label}`, () => {
    const { data, body } = splitFrontMatter(`---\n${block}\n---\nbody`);
    assert.equal(data, null);
    assert.equal(body, 'body');
  });
}

test('assetUrls sorts the published URLs by file name', () => {
  assert.deepEqual(assetUrls('acme', ['c.svg', 'a.png', 'b.svg']), [
    '/img/architectures/acme/a.png',
    '/img/architectures/acme/b.svg',
    '/img/architectures/acme/c.svg',
  ]);
});

test('listPageAssets lists the regular files in images/ sorted by name', () => {
  withDocsDir(
    {
      'acme/images/b.svg': '<svg/>',
      'acme/images/a.png': 'png',
      'acme/images/nested': null,
    },
    (docsDir) => {
      assert.deepEqual(listPageAssets(docsDir, 'acme'), [
        '/img/architectures/acme/a.png',
        '/img/architectures/acme/b.svg',
      ]);
    },
  );
});

test('listPageAssets is empty when the page has no images/ directory', () => {
  withDocsDir({ 'acme/index.md': '' }, (docsDir) => {
    assert.deepEqual(listPageAssets(docsDir, 'acme'), []);
  });
});

test('listPageAssets rethrows a failure other than a missing directory', () => {
  withDocsDir({ 'acme/images': 'not a directory' }, (docsDir) => {
    assert.throws(() => listPageAssets(docsDir, 'acme'), { code: 'ENOTDIR' });
  });
});

test('recordFromFrontMatter copies the authored keys in catalog order', () => {
  withDocsDir({ 'acme/images/d.svg': '<svg/>' }, (docsDir) => {
    const record = recordFromFrontMatter(docsDir, 'acme', {
      title: 'Acme',
      sidebar_label: 'Acme',
      architecture: {
        updated: '2026-04-15',
        organization: 'Acme Corp',
        industry: 'typo',
        published: '2026-03-01',
      },
    });
    assert.deepEqual(Object.keys(record), [
      'id',
      'title',
      'organization',
      'published',
      'updated',
      'assets',
    ]);
    assert.equal(record.id, 'acme');
    assert.deepEqual(record.assets, ['/img/architectures/acme/d.svg']);
    assert.equal('industry' in record, false);
  });
});

for (const [label, architecture] of [
  ['absent', undefined],
  ['null', null],
  ['a list', ['x']],
  ['a string', 'yes'],
]) {
  test(`recordFromFrontMatter treats an architecture key that is ${label} as empty`, () => {
    withDocsDir({}, (docsDir) => {
      const record = recordFromFrontMatter(docsDir, 'acme', {
        title: 'Acme',
        architecture,
      });
      assert.deepEqual(record, { id: 'acme', title: 'Acme', assets: [] });
    });
  });
}

test('collectArchitectureRecords reads every page, skipping the repo-authored ones', () => {
  withDocsDir(
    {
      'index.md': '# Catalog\n',
      'submit.md': '# Submit\n',
      'zeta/index.md': page({ organization: 'Beta' }),
      'alpha/index.md': page({ organization: 'Beta' }),
      'acme/index.mdx': page({ organization: 'Acme' }),
    },
    (docsDir) => {
      const { records, problems, irregular } = collectArchitectureRecords(
        docsDir,
        ['index.md', 'submit.md'],
      );
      assert.deepEqual(problems, []);
      assert.deepEqual(irregular, []);
      // Catalog order: organization, then id as the tie-break.
      assert.deepEqual(
        records.map((record) => [record.id, record.page]),
        [
          ['acme', 'acme/index.mdx'],
          ['alpha', 'alpha/index.md'],
          ['zeta', 'zeta/index.md'],
        ],
      );
    },
  );
});

test('collectArchitectureRecords sorts records with no organization first, by id', () => {
  withDocsDir(
    {
      'acme/index.md': page({ organization: 'Acme' }),
      'zed/index.md': '---\ntitle: Zed\n---\n',
      'anon/index.md': '---\ntitle: Anon\n---\n',
    },
    (docsDir) => {
      const { records } = collectArchitectureRecords(docsDir, []);
      assert.deepEqual(
        records.map((record) => record.id),
        ['anon', 'zed', 'acme'],
      );
    },
  );
});

test('collectArchitectureRecords reports pages that cannot yield a record', () => {
  withDocsDir(
    {
      'orphan.md': '# Orphan\n',
      'nested/deep/index.md': page({ organization: 'Acme' }),
      'bare/index.md': '# Bare\n',
      'acme/index.md': page({ organization: 'Acme' }),
    },
    (docsDir) => {
      const { records, problems } = collectArchitectureRecords(docsDir, []);
      assert.deepEqual(
        records.map((record) => record.id),
        ['acme'],
      );
      assert.deepEqual(problems, [
        {
          page: 'bare/index.md',
          message:
            'page has no YAML front matter mapping to read metadata from',
        },
        {
          page: 'nested/deep/index.md',
          message:
            'page is not at <id>/index.md; an architecture is a directory holding index.md and images/',
        },
        {
          page: 'orphan.md',
          message:
            'page is not at <id>/index.md; an architecture is a directory holding index.md and images/',
        },
      ]);
    },
  );
});

test('catalogRecords drops the page field and keeps catalog key order', () => {
  assert.deepEqual(
    catalogRecords([
      { page: 'acme/index.md', assets: [], title: 'Acme', id: 'acme' },
    ]),
    [{ id: 'acme', title: 'Acme', assets: [] }],
  );
});

test('serializeCatalog writes two-space JSON with a trailing newline', () => {
  assert.equal(
    serializeCatalog([{ id: 'acme', page: 'acme/index.md' }]),
    '[\n  {\n    "id": "acme"\n  }\n]\n',
  );
});
