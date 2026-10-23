/**
 * Premises that make five mutants equivalent across the import-time libraries
 * swept this round: architecture-content.mjs, architecture-pages.mjs,
 * cncf-wp-api.mjs and github.mjs.
 *
 * Each of those mutants is annotated at its site with a `// Stryker disable`
 * directive naming the premise it rests on. A premise that quietly stops
 * holding turns its annotation into a silent suppression of a real gap, so the
 * premises are asserted here rather than left to the comment alone.
 *
 * These are behavioural assertions against each module's public surface. None
 * of them reads a source file as text, so they run unchanged inside Stryker's
 * instrumented copy of the tree.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REPO_AUTHORED_PAGES,
  RESERVED_PAGE_IDS,
  listArchitecturePages,
} from '../scripts/lib/architecture-pages.mjs';
import { fetchAllPages } from '../scripts/lib/cncf-wp-api.mjs';
import { githubAllPages } from '../scripts/lib/github.mjs';
import { mirrorArtworkUrls } from '../scripts/lib/architecture-content.mjs';
import {
  artworkMirrorPath,
  artworkPath,
} from '../scripts/lib/project-assets.mjs';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'equivalence-premises-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

// Runs a paginated fetch against a stub that answers every request with a
// one-item page and the given header lookup, and reports how many pages the
// walk asked for.
async function countPages(run, getHeader = () => null) {
  let calls = 0;
  const results = await withFetch(async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => [{ id: calls }],
      headers: { get: getHeader },
    };
  }, run);
  return { calls, results };
}

// --- architecture-pages.mjs: RESERVED_PAGE_IDS strips with an anchored /\.mdx?$/
//
// Dropping the `$` only matters for a name carrying `.md` somewhere other than
// its final extension. No repo-authored page name does, so both forms strip
// the same suffix. Assert the shape rather than the current two names, so a
// page added later that would break the premise fails here.
test('every repo-authored page name carries exactly one trailing .md/.mdx', () => {
  assert.ok(REPO_AUTHORED_PAGES.size > 0);
  for (const page of REPO_AUTHORED_PAGES) {
    assert.match(page, /^[^.]+\.mdx?$/, page);
    assert.equal(page.replace(/\.mdx?$/, ''), page.replace(/\.mdx?/, ''), page);
  }
});

test('RESERVED_PAGE_IDS holds each page name with its extension removed', () => {
  assert.deepEqual(
    [...RESERVED_PAGE_IDS].sort(),
    [...REPO_AUTHORED_PAGES].map((page) => page.replace(/\.mdx?$/, '')).sort(),
  );
});

// --- architecture-pages.mjs: the `catch` in resolvesToDirectory()
//
// The helper is module-private and its result is consumed only as the right
// operand of an `||`, so returning `false` and returning nothing are the same
// decision. What has to keep holding is the decision itself: a symlink whose
// target cannot be stat'd is not treated as a directory, so it is reported
// only when its own name carries a page extension.
test('a symlink whose target cannot be stat-ed is not treated as a directory', () => {
  const { root, cleanup } = sandbox();
  try {
    const docs = join(root, 'docs');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, 'index.md'), '#');
    // Broken target, and a self-referential link that makes statSync throw
    // ELOOP rather than ENOENT -- both reach the catch.
    symlinkSync(join(root, 'nonexistent'), join(docs, 'dangling-noext'));
    symlinkSync(join(docs, 'loop'), join(docs, 'loop'));
    // The same two failures, but named like pages: these are reported on the
    // extension test alone, which is what makes the pair above meaningful.
    symlinkSync(join(root, 'nonexistent'), join(docs, 'dangling.md'));

    const { pages, irregular } = listArchitecturePages(docs);
    assert.deepEqual(pages, ['index.md']);
    assert.deepEqual(irregular, ['dangling.md']);
  } finally {
    cleanup();
  }
});

// --- cncf-wp-api.mjs: `Number(headers.get('x-wp-totalpages') || '1')`
//
// Emptying the fallback would make `totalPages` 0 instead of 1. Neither value
// can change the walk, because `page` starts at 1 and the loop breaks on
// `page >= totalPages`, which is already true for both. The premise is that
// a response advertising no page count is fetched exactly once.
test('a WordPress response with no x-wp-totalpages header is fetched once', async () => {
  const { calls, results } = await countPages(() =>
    fetchAllPages('https://www.cncf.io/wp-json/wp/v2', 'posts'),
  );
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ id: 1 }]);
});

test('a WordPress response advertising one page is also fetched once', async () => {
  const { calls } = await countPages(
    () => fetchAllPages('https://www.cncf.io/wp-json/wp/v2', 'posts'),
    (name) => (name === 'x-wp-totalpages' ? '1' : null),
  );
  assert.equal(calls, 1);
});

// --- github.mjs: `response.headers.get('link') || ''`
//
// The fallback is only read by a `rel="next"` match one line later, so any
// value without that shape ends pagination exactly as the empty string does.
// The premise is that a response carrying no usable Link header is the last
// page.
test('a GitHub response with no Link header ends pagination', async () => {
  const { calls, results } = await countPages(() =>
    githubAllPages('https://api.github.com/orgs/cncf/repos', {}),
  );
  assert.equal(calls, 1);
  assert.deepEqual(results, [{ id: 1 }]);
});

test('a Link header naming no rel="next" target ends pagination', async () => {
  const { calls } = await countPages(
    () => githubAllPages('https://api.github.com/orgs/cncf/repos', {}),
    (name) =>
      name === 'link'
        ? '<https://api.github.com/orgs/cncf/repos?page=1>; rel="prev"'
        : null,
  );
  assert.equal(calls, 1);
});

// --- architecture-content.mjs: `writeFileSync(destination, source, 'utf8')`
//
// Node resolves an empty encoding argument to the default, which is utf8, so
// emptying the literal writes the same bytes. The literal records the
// contract rather than selecting it, and the contract is what is asserted:
// a mirrored SVG lands on disk as the UTF-8 encoding of the stripped source,
// not as latin1 or any other single-byte reading of it.
test('a mirrored SVG is written as UTF-8 bytes', async () => {
  const url =
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/helm/icon/color/helm-icon-color.svg';
  // Non-ASCII in the title is what makes the encoding observable: every
  // character here is multi-byte in UTF-8 and single-byte in latin1.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>Ω é 中</title><rect width="1" height="1"/></svg>';
  const { root, cleanup } = sandbox();
  try {
    const destination = join(root, artworkMirrorPath(artworkPath(url)));
    await withFetch(
      async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode(svg).buffer,
      }),
      () => mirrorArtworkUrls(root, [url]),
    );
    assert.deepEqual(readFileSync(destination), Buffer.from(svg, 'utf8'));
    assert.equal(readFileSync(destination, 'utf8'), svg);
  } finally {
    cleanup();
  }
});
