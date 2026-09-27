// Region-coverage companion to tests/import-architectures.test.mjs.
//
// scripts/import-architectures.mjs is 100% line-covered, so every case here
// exercises a sub-line region that line coverage cannot see: a `??` fallback,
// the false arm of a ternary, or a `continue` guard whose line already ran.
// Three of them are fail-closed paths -- no hot-linking, no unmirrorable
// fetch, no special files -- where a regression would leave the line score
// untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runImportArchitectures } from './helpers-import-sandbox.mjs';

const architecture = (id, markdown, extras = {}) => ({
  [`content/en/architectures/${id}/index.md`]: markdown,
  ...extras,
});

test('an empty frontmatter block falls back to an empty record, not a crash', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
---

Acme runs a platform.
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/acme.json');
    // yamlParse('') is null, so `?? {}` is what keeps the property reads below
    // from throwing; title and organization then fall back to the directory id.
    assert.equal(record.title, 'acme');
    assert.equal(record.organization, 'acme');
    assert.deepEqual(record.industries, []);
    assert.deepEqual(record.tags, []);
    assert.equal(record.summary, 'Acme runs a platform.');
  } finally {
    run.cleanup();
  }
});

test('a remote image outside cncf/artwork is demoted to a link, never hot-linked', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.

![Topology diagram](https://cdn.example.com/diagram.png)
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme.md');
    assert.match(
      page,
      /\[Topology diagram\]\(https:\/\/cdn\.example\.com\/diagram\.png\)/,
    );
    // The image syntax must be gone: an `![...]` would make the browser fetch
    // cdn.example.com on page load, which is the beacon this arm prevents.
    assert.doesNotMatch(page, /!\[Topology diagram\]/);
  } finally {
    run.cleanup();
  }
});

test('a cncf/artwork image is rewritten to its mirrored local path', () => {
  // Contrast case for the test above: the true arm of the same ternary. Without
  // it, "no hot-link" would also be satisfied by dropping every image.
  const url =
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/kubernetes/icon/color/kubernetes-icon-color.png';
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.

![Kubernetes](${url})
`,
    ),
    fetchResponses: { [url]: { status: 200, body: 'png-bytes' } },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme.md');
    assert.match(
      page,
      /!\[Kubernetes\]\(\/img\/cncf-projects\/kubernetes-kubernetes-icon-color\.png\)/,
    );
    assert.equal(
      run.read('static/img/cncf-projects/kubernetes-kubernetes-icon-color.png'),
      'png-bytes',
    );
  } finally {
    run.cleanup();
  }
});

test('an artwork URL with no derivable mirror name is skipped before any fetch', () => {
  // artworkPath() resolves this to `projects`, a single segment, so
  // artworkMirrorPath() returns null and mirrorProjectAssets() must `continue`
  // rather than fetch. The sandbox stubs fetch with an empty response table,
  // so reaching the fetch would warn instead of silently succeeding.
  const url = 'https://raw.githubusercontent.com/cncf/artwork/main/projects';
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.

![Artwork index](${url})
`,
    ),
    fetchResponses: {},
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, /Could not mirror CNCF project asset/);
    assert.equal(run.exists('static/img/cncf-projects'), false);
    // The unmirrorable URL also fails closed in the page: link, not image.
    const page = run.read('docs/architectures/acme.md');
    assert.match(page, /\[Artwork index\]\(https:\/\/raw\.githubusercontent/);
    assert.doesNotMatch(page, /!\[Artwork index\]/);
  } finally {
    run.cleanup();
  }
});

test('a body with no prose paragraph summarises to an empty string', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

# Acme

- Kubernetes
- Prometheus
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/acme.json');
    // Every paragraph starts with a structural character, so `find` returns
    // undefined and the `?? ''` fallback supplies the summary.
    assert.equal(record.summary, '');
  } finally {
    run.cleanup();
  }
});

test('a special file in images/ is dropped by the walk, not reported as an asset', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.
`,
      { 'content/en/architectures/acme/images/real.png': 'png-bytes' },
    ),
    upstreamFifos: ['content/en/architectures/acme/images/pipe'],
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/acme.json');
    assert.deepEqual(record.assets, ['/img/architectures/acme/real.png']);
    assert.equal(run.exists('static/img/architectures/acme/pipe'), false);
    // walkFiles() drops the FIFO itself. Had it returned the path instead, the
    // importer would have reached the extension check and warned about it --
    // and then tried to cpSync a named pipe.
    assert.doesNotMatch(run.stderr, /is not a mirrorable image type/);
  } finally {
    run.cleanup();
  }
});

test('an SVG with no viewBox and no dimensions is left alone, not given a NaN viewBox', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>\n';
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.
`,
      { 'content/en/architectures/acme/images/plain.svg': svg },
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const mirrored = run.read('static/img/architectures/acme/plain.svg');
    // Both dimension matches are null, so both ternaries take their NaN arm
    // and the synthesised viewBox is skipped entirely.
    assert.equal(mirrored, svg);
    assert.doesNotMatch(mirrored, /viewBox/i);
    assert.doesNotMatch(mirrored, /NaN/);
  } finally {
    run.cleanup();
  }
});

test('an SVG with explicit dimensions still gains a viewBox', () => {
  // Contrast case for the test above: the ternaries' true arms must keep
  // working, or "no NaN viewBox" would be satisfied by never adding one.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect /></svg>\n';
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: Acme
---

Acme runs a platform.
`,
      { 'content/en/architectures/acme/images/sized.svg': svg },
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const mirrored = run.read('static/img/architectures/acme/sized.svg');
    assert.match(mirrored, /<svg viewBox="0 0 320 240"/);
  } finally {
    run.cleanup();
  }
});
