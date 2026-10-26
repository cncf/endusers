import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GroupLinkStatus renders data/community-groups.json on /community/ as the
// drift warning for the User Groups the site publishes. The report is written
// by the GROUPS table in scripts/check-community-group-links.mjs, which is
// maintained by hand (index.md is the hub, not a group); a group page added without a matching table entry leaves
// that group's upstream repository unchecked for ever, and the panel keeps
// saying the status is up to date. These tests fail on that drift instead.

const root = fileURLToPath(new URL('..', import.meta.url));
const pagesDir = join(root, 'docs/community/user-groups');
const report = JSON.parse(
  readFileSync(join(root, 'data/community-groups.json'), 'utf8'),
);

function pages() {
  return readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      slug: entry.name,
      file: `docs/community/user-groups/${entry.name}/index.md`,
      body: readFileSync(join(pagesDir, entry.name, 'index.md'), 'utf8'),
    }));
}

test('every published User Group page has a status entry', () => {
  const covered = new Set(report.groups.map((group) => group.slug));
  const missing = pages()
    .filter((page) => !covered.has(page.slug))
    .map((page) => page.file);

  assert.deepEqual(
    missing,
    [],
    `${missing.join(', ')} publish a User Group that data/community-groups.json does not cover; add it to GROUPS in scripts/check-community-group-links.mjs`,
  );
});

test('every status entry belongs to a published User Group page', () => {
  const published = new Set(pages().map((page) => page.slug));
  const orphaned = report.groups
    .map((group) => group.slug)
    .filter((slug) => !published.has(slug));

  assert.deepEqual(
    orphaned,
    [],
    `data/community-groups.json reports ${orphaned.join(', ')}, which no page under docs/community/user-groups/ publishes`,
  );
});

test('each status entry names the repository its page links', () => {
  const bySlug = new Map(report.groups.map((group) => [group.slug, group]));
  for (const page of pages()) {
    const group = bySlug.get(page.slug);
    if (!group) continue;
    assert.ok(
      page.body.includes(group.repository),
      `${page.file} does not link ${group.repository}, the repository data/community-groups.json watches for it`,
    );
  }
});
