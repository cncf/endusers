import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'yaml';
import { catalogRecords } from '../scripts/lib/architecture-frontmatter.mjs';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-architectures.mjs';

// The authored half of a valid record: what sits under `architecture:` in a
// page's front matter. `id` is the directory name and `assets` the images/
// listing, both derived, so neither is written here.
const validAuthored = {
  organization: 'Acme Corp',
  summary: 'Acme runs a multi-region platform.',
  industries: ['Retail'],
  tags: ['kubernetes'],
  projects: ['Kubernetes'],
  sourceUrl: 'https://github.com/cncf/architecture/blob/main/acme-platform.md',
  sourceCommit: 'a'.repeat(40),
  published: '2026-03-01',
  updated: '2026-04-15',
};

const validRecord = {
  id: 'acme-platform',
  title: 'Acme Platform',
  ...validAuthored,
  assets: ['/img/architectures/acme-platform/diagram.svg'],
};

// Writes a page for each record, its metadata in front matter, and a
// catalog.json that is the generated mirror of exactly those records; a test
// that wants the catalog to disagree passes its own `catalog`.
function page(record, body = '# Acme\n') {
  const { id, title, assets, ...architecture } = record;
  return `---\n${stringify({ title, architecture }).trimEnd()}\n---\n\n${body}`;
}

function pageFixture(records, extraFiles = {}, { catalog = records } = {}) {
  const files = {
    'data/architectures/catalog.json': JSON.stringify(catalogRecords(catalog)),
    'docs/architectures/acme-platform/images/diagram.svg': '<svg/>',
  };
  for (const record of records)
    files[`docs/architectures/${record.id}/index.md`] = page(record);
  return { ...files, ...extraFiles };
}

function withAuthored(overrides) {
  return { ...validRecord, ...overrides };
}

test('accepts a valid page and its generated catalog', () => {
  const result = runScriptWithFixtures(SCRIPT, pageFixture([validRecord]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 architecture records/);
});

// The catalog is a generated mirror of the pages. Comparing parsed records
// means `fix:format` refolding the file is not drift, but any change to what
// the pages say is.
test('accepts a catalog that differs from the pages only in formatting', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'data/architectures/catalog.json':
        JSON.stringify([validRecord], null, 4) + '\n\n',
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a catalog that is behind the pages', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture(
      [withAuthored({ summary: 'Edited in the page.' })],
      {},
      {
        catalog: [validRecord],
      },
    ),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] data\/architectures\/catalog\.json: catalog is behind the pages' front matter; run `npm run generate:architectures`/,
  );
});

test('rejects a catalog that names an architecture with no page', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture(
      [validRecord],
      {},
      {
        catalog: [validRecord, { ...validRecord, id: 'ghost' }],
      },
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog is behind the pages' front matter/);
});

test('rejects a catalog with derived fields that do not match the directory', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture(
      [validRecord],
      {},
      {
        catalog: [{ ...validRecord, assets: [] }],
      },
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog is behind the pages' front matter/);
});

for (const [label, content] of [
  ['absent', undefined],
  ['not valid JSON', '{'],
]) {
  test(`reports a catalog that is ${label}`, () => {
    const fixtures = pageFixture([validRecord]);
    if (content === undefined)
      delete fixtures['data/architectures/catalog.json'];
    else fixtures['data/architectures/catalog.json'] = content;
    const result = runScriptWithFixtures(SCRIPT, fixtures);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /catalog is missing or not valid JSON; run `npm run generate:architectures`/,
    );
  });
}

test('reports the page errors alongside the drift they cause', () => {
  // A broken page is the cause and the stale catalog the symptom; a
  // maintainer must see both, not a drift message that hides the real fix.
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture(
      [withAuthored({ published: 'yesterday' })],
      {},
      {
        catalog: [validRecord],
      },
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /published must be a YYYY-MM-DD calendar date/);
  assert.match(result.stderr, /catalog is behind the pages' front matter/);
});

test('requires a title and an organization', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([{ ...validRecord, title: '', organization: '' }]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] acme-platform\/index\.md: front matter must set title and architecture\.organization/,
  );
});

test('requires a non-empty summary', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ summary: '  ' })]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /architecture\.summary must be a non-empty string/,
  );
});

for (const key of ['industries', 'tags', 'projects']) {
  for (const [label, value] of [
    ['missing', undefined],
    ['a string', 'Retail'],
    ['holding an empty item', ['Retail', '']],
    ['holding a number', [42]],
  ]) {
    test(`rejects ${key} that is ${label}`, () => {
      const result = runScriptWithFixtures(
        SCRIPT,
        pageFixture([withAuthored({ [key]: value })]),
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(`architecture\\.${key} must be a list of non-empty strings`),
      );
    });
  }
}

test('accepts empty lists for industries, tags and projects', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ industries: [], tags: [], projects: [] })]),
  );
  assert.equal(result.status, 0, result.stderr);
});

for (const [label, overrides, pattern] of [
  [
    'a missing published date',
    { published: undefined },
    /published must be a YYYY-MM-DD calendar date/,
  ],
  [
    'a timestamp as updated',
    { updated: '2026-04-15T10:00:00Z' },
    /updated must be a YYYY-MM-DD calendar date/,
  ],
  [
    'an impossible calendar day',
    { updated: '2026-02-30' },
    /updated must be a YYYY-MM-DD calendar date/,
  ],
  [
    'a non-string date',
    { published: 20260301 },
    /published must be a YYYY-MM-DD calendar date/,
  ],
  [
    'an updated date before published',
    { updated: '2026-02-28' },
    /updated must not be earlier than published/,
  ],
]) {
  test(`rejects a page with ${label}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      pageFixture([withAuthored(overrides)]),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
  });
}

// YAML parses a bare 2026-03-01 as a date in some dialects; the `yaml`
// package's default schema keeps it a string, which the date rule relies on.
test('reads an unquoted YAML date as the calendar string it is written as', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...pageFixture([validRecord]),
    'docs/architectures/acme-platform/index.md': page(validRecord).replace(
      /published: .*/,
      'published: 2026-03-01',
    ),
  });
  assert.equal(result.status, 0, result.stderr);
});

test('rejects a tag written with underscores', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ tags: ['kubernetes', 'private_cloud'] })]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a string using spaces, not underscores/);
});

test('accepts tags written with spaces', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ tags: ['private cloud', 'ci-cd'] })]),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('accepts a page updated on the day it was published', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ updated: validRecord.published })]),
  );
  assert.equal(result.status, 0, result.stderr);
});

// Two directories cannot share a name, so a duplicate id can only come from a
// page at `<id>/index.md` and another at `<id>/index.mdx`.
test('rejects duplicate ids across .md and .mdx pages', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/acme-platform/index.mdx': page(validRecord),
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate id/);
});

for (const [label, sourceUrl] of [
  ['absent', undefined],
  ['not https', 'http://example.com/a'],
  ['a javascript: URL', 'javascript:alert(1)'],
  ['not a parseable URL', 'not a url'],
  ['not a string', 42],
  // A userinfo component makes the visible prefix and the real host
  // disagree: "https://www.cncf.io@evil.example/x" reads as CNCF in a diff
  // and resolves to evil.example in a browser. sourceUrl is rendered as an
  // href in the member directory.
  ['carrying a userinfo component', 'https://www.cncf.io@evil.example/x'],
  ['carrying a password-only userinfo', 'https://:token@evil.example/x'],
]) {
  test(`rejects a sourceUrl that is ${label}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      pageFixture([withAuthored({ sourceUrl })]),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /sourceUrl must be an https URL/);
  });
}

// A page is either pinned to the cncf/architecture commit it was taken from or
// cites the submission issue it came from; the attribution line on the page
// and the member directory both depend on knowing which.
test('rejects a page that sets both sourceCommit and sourceIssue', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ sourceIssue: 900 })]),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must set exactly one of sourceCommit \(cncf\/architecture import\) or sourceIssue \(submission issue\)/,
  );
});

test('rejects a page that sets neither sourceCommit nor sourceIssue', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([withAuthored({ sourceCommit: undefined })]),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must set exactly one of sourceCommit/);
});

test('accepts an issue-sourced page', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([
      withAuthored({
        sourceCommit: undefined,
        sourceIssue: 900,
        sourceUrl: 'https://example.com/submissions/900',
      }),
    ]),
  );
  assert.equal(result.status, 0, result.stderr);
});

for (const [label, sourceIssue] of [
  ['a string', '900'],
  ['a fraction', 9.5],
]) {
  test(`rejects a sourceIssue that is ${label}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      pageFixture([withAuthored({ sourceCommit: undefined, sourceIssue })]),
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /architecture\.sourceIssue must be an issue number/,
    );
  });
}

for (const [label, sourceCommit] of [
  ['abbreviated', 'abc1234'],
  ['upper-case', 'A'.repeat(40)],
  ['not a string', 42],
]) {
  test(`rejects a sourceCommit that is ${label}`, () => {
    const result = runScriptWithFixtures(
      SCRIPT,
      pageFixture([withAuthored({ sourceCommit })]),
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /architecture\.sourceCommit must be a full 40-character commit SHA/,
    );
  });
}

// An author who misspells a field (`industry:`) would otherwise see it dropped
// from the catalog silently, and the catalog card lose that facet.
test('rejects an unknown field under architecture', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...pageFixture([validRecord]),
    'docs/architectures/acme-platform/index.md': page(validRecord).replace(
      'architecture:\n',
      'architecture:\n  industry: Retail\n',
    ),
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] acme-platform\/index\.md: architecture\.industry is not a catalog field; the fields are organization, summary, industries, tags, projects, sourceUrl, sourceCommit, sourceIssue, published, updated/,
  );
});

test('rejects a page with no front matter', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...pageFixture([validRecord]),
    'docs/architectures/acme-platform/index.md': '# Acme\n',
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] acme-platform\/index\.md: page has no YAML front matter mapping to read metadata from/,
  );
});

for (const [label, frontMatter] of [
  ['a YAML list', '- a\n- b'],
  ['a scalar', 'just text'],
  ['invalid YAML', 'title: [unclosed'],
]) {
  test(`rejects a page whose front matter is ${label}`, () => {
    const result = runScriptWithFixtures(SCRIPT, {
      ...pageFixture([validRecord]),
      'docs/architectures/acme-platform/index.md': `---\n${frontMatter}\n---\n\n# Acme\n`,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /page has no YAML front matter mapping/);
  });
}

test('treats a page whose architecture key is not a mapping as having no metadata', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...pageFixture([validRecord]),
    'docs/architectures/acme-platform/index.md':
      '---\ntitle: Acme Platform\narchitecture: yes\n---\n\n# Acme\n',
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /front matter must set title and architecture\.organization/,
  );
  assert.doesNotMatch(result.stderr, /is not a catalog field/);
});

test('rejects a directory name that is not a lowercase slug', () => {
  const record = { ...validRecord, id: 'Acme_Platform', assets: [] };
  const result = runScriptWithFixtures(SCRIPT, pageFixture([record]));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] Acme_Platform\/index\.md: directory name must be a lowercase slug/,
  );
});

// A page without images/ is what an issue-sourced architecture starts as.
test('accepts a page whose directory has no images', () => {
  const fixtures = pageFixture([{ ...validRecord, assets: [] }]);
  delete fixtures['docs/architectures/acme-platform/images/diagram.svg'];
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 0, result.stderr);
});

// Only regular files in images/ are published assets; a nested directory is
// neither listed nor published.
test('lists only the regular files in images as assets', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/acme-platform/images/nested/other.svg': '<svg/>',
    }),
  );
  assert.equal(result.status, 0, result.stderr);
});

test('rejects active content in an imported architecture page', () => {
  const fixtures = pageFixture([validRecord], {
    'docs/architectures/acme-platform/index.md': page(
      validRecord,
      '# Acme\n\n<script>fetch("https://evil.test")</script>\n',
    ),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  // Line numbers count the front matter: the body here starts at line 17.
  assert.match(result.stderr, /acme-platform\/index\.md:20/);
  assert.match(result.stderr, /active content in imported page/);
});

test('accepts an imported architecture page with only inert content', () => {
  const fixtures = pageFixture([validRecord], {
    'docs/architectures/acme-platform/index.md': page(
      validRecord,
      [
        "import CNCFProjectCard from '@site/src/components/CNCFProjectCard';",
        '',
        '# Acme',
        '',
        '<CNCFProjectCard name="Kubernetes" href="https://www.cncf.io/projects/kubernetes/" />',
        '',
      ].join('\n'),
    ),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects an imported architecture page image with no alt text', () => {
  const fixtures = pageFixture([validRecord], {
    'docs/architectures/acme-platform/index.md': page(
      validRecord,
      '# Acme\n\n![](./images/diagram.svg)\n',
    ),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /image has no alt text/);
});

test('accepts an imported architecture page whose images carry alt text', () => {
  const fixtures = pageFixture([validRecord], {
    'docs/architectures/acme-platform/index.md': page(
      validRecord,
      '# Acme\n\n![Acme platform diagram](./images/diagram.svg)\n\n[Full size](images/diagram.svg)\n',
    ),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 0, result.stderr);
});

// Docusaurus bundles whatever file a relative destination names and publishes
// it under /assets/, so a page may only reach its own gated images/ directory.
test('rejects a relative destination outside the page images directory', () => {
  const fixtures = pageFixture([validRecord], {
    'docs/architectures/acme-platform/index.md': page(
      validRecord,
      [
        '# Acme',
        '',
        '![Secrets](../../../.env)',
        '',
        '[Other](../other/images/diagram.svg)',
        '',
        '[Encoded](./images/%2e%2e/index.md)',
        '',
        '[Malformed](./images/%E0%A4%A)',
        '',
        '![Diagram](./images/diagram.svg?v=1#top)',
        '',
      ].join('\n'),
    ),
  });
  const result = runScriptWithFixtures(SCRIPT, fixtures);
  assert.equal(result.status, 1);
  for (const url of [
    '../../../.env',
    '../other/images/diagram.svg',
    './images/%2e%2e/index.md',
    './images/%E0%A4%A',
  ])
    assert.ok(
      result.stderr.includes(
        `relative destination ${url} must stay inside this architecture's images/ directory`,
      ),
      result.stderr,
    );
  assert.doesNotMatch(result.stderr, /diagram\.svg\?v=1#top/);
});

// Docusaurus routes docs/ by filesystem, so a page outside the <id>/index.md
// layout is published anyway. It cannot carry a catalog record, and the
// content scan must still reach it.
test('rejects a top-level page and still scans it for active content', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/orphan.md':
        '# Orphan\n\n<iframe src="https://evil.example"></iframe>\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] orphan\.md: page is not at <id>\/index\.md/,
  );
  assert.match(
    result.stderr,
    /orphan\.md:3: active content in imported page \(disallowed element <iframe>\)/,
  );
});

// An MDX expression is evaluated JavaScript, so an unscanned page runs code in
// the build job that holds the deploy credential.
test('scans a misplaced page for MDX expressions', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/orphan.md': '# Orphan\n\nvalue: {String(1)}\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /orphan\.md:3: active content in imported page \(MDX expression\)/,
  );
});

// Docusaurus's docs plugin publishes .mdx from the same default `include` as
// .md, so a page that only differs by extension must reach the same gate.
test('scans an .mdx page for active content', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/orphan.mdx':
        '# Orphan\n\n<iframe src="https://evil.example"></iframe>\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /orphan\.mdx:3: active content in imported page \(disallowed element <iframe>\)/,
  );
});

test('scans a page with no front matter for active content', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    ...pageFixture([validRecord]),
    'docs/architectures/acme-platform/index.md':
      '# Acme\n\nvalue: {String(1)}\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /page has no YAML front matter mapping/);
  assert.match(
    result.stderr,
    /acme-platform\/index\.md:3: active content in imported page \(MDX expression\)/,
  );
});

// index.md and submit.md are hand-authored, not imported: they render layout
// elements and index.md imports a component, all of which the imported-content
// gate is right to reject in an imported body. Scanning them would turn CI red
// on repo content.
test('exempts the hand-authored pages from the imported-content gate', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/index.md':
        '# Catalog\n\n<div className="pillars"><h3>Why</h3></div>\n\nimport X from \'@site/src/components/X\';\n\n<X />\n',
      'docs/architectures/submit.md':
        '# Submit\n\n<div className="benefit-cards"><h3>Review</h3></div>\n',
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 architecture records/);
});

// A directory named `index` serves the same route as the hand-authored page
// above, and the exemption then publishes that imported body without scanning
// it. The importer derives the id from text it does not control (a submission
// issue's "Organization or Team Name" answer), so the directory has to be
// rejected for the exemption to stay safe.
test('rejects a directory that claims a repo-authored page id', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([{ ...validRecord, id: 'index', assets: [] }], {
      'docs/architectures/index.md':
        '# Index\n\n<iframe src="https://evil.example/beacon"></iframe>\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[error\] index\/index\.md: id is reserved/);
});

test('reserves every repo-authored page id, not just index', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([{ ...validRecord, id: 'submit', assets: [] }], {
      'docs/architectures/submit.md': '# Submit\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[error\] submit\/index\.md: id is reserved/);
});

// A nested page is published at its own route and can never be an
// architecture, so it is reported rather than silently walked past.
test('rejects a nested page under docs/architectures', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/architectures/reports/leftover.md': '# Leftover\n',
    }),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] reports\/leftover\.md: page is not at <id>\/index\.md/,
  );
});

// Dirent.isFile() is false for a symlink, so a symlinked page would be walked
// past and published unread if it were merely skipped.
test('rejects a symlinked page rather than skipping it', () => {
  const result = runScriptWithFixtures(SCRIPT, pageFixture([validRecord]), {
    symlinks: { 'docs/architectures/linked.md': '/etc/hostname' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /linked\.md: page must be a regular file/);
});

// `@docusaurus/plugin-content-docs` globs with fast-glob's default
// `followSymbolicLinks: true`, so every page under `linked/` is published at
// `/architectures/linked/...`. The gate must fail on the link itself, because
// it is the one thing it can see without following it.
test('rejects a symlinked directory of pages rather than walking past it', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    pageFixture([validRecord], {
      'docs/elsewhere/evil.md': '# Evil\n\n<div onclick="steal()">x</div>\n',
    }),
    { symlinks: { 'docs/architectures/linked': '../elsewhere' } },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\[error\] linked: page must be a regular file; a symlinked page, or a symlinked directory of pages, is published but cannot be gated/,
  );
  // Reported, never followed: a report naming `linked/evil.md` would mean the
  // gate had descended through a link it refuses to trust.
  assert.doesNotMatch(result.stderr, /linked\/evil\.md/);
});

// A link to something Docusaurus does not route publishes nothing, so it is
// still skipped and the run still passes.
test('accepts a symlink that resolves to neither a page nor a directory', () => {
  const result = runScriptWithFixtures(SCRIPT, pageFixture([validRecord]), {
    symlinks: { 'docs/architectures/notes.txt': '/etc/hostname' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /notes\.txt/);
});
