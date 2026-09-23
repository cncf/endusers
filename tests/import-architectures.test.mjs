import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FAKE_COMMIT,
  runImportArchitectures,
} from './helpers-import-sandbox.mjs';

const architecture = (id, markdown) => ({
  [`content/en/architectures/${id}/index.md`]: markdown,
});

test('imports an architecture into catalog, record and docs page', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'acme',
      `---
title: "Acme — Cloud Native Platform"
org_name: Acme Corp
industries:
  - Retail
  - Logistics
tags:
  - kubernetes
---

Acme runs a multi-region platform on Kubernetes.

## Details

More text.
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Imported 1 architectures from /);

    const catalog = run.readJson('data/architectures/catalog.json');
    assert.equal(catalog.length, 1);
    assert.deepEqual(catalog[0], {
      id: 'acme',
      title: 'Acme — Cloud Native Platform',
      organization: 'Acme Corp',
      summary: 'Acme runs a multi-region platform on Kubernetes.',
      industries: ['Retail', 'Logistics'],
      tags: ['kubernetes'],
      projects: [],
      sourceUrl: `https://github.com/cncf/architecture/tree/${FAKE_COMMIT}/content/en/architectures/acme`,
      sourceCommit: FAKE_COMMIT,
      assets: [],
    });

    const record = run.readJson('data/architectures/records/acme.json');
    assert.deepEqual(record, catalog[0]);

    const page = run.read('docs/architectures/acme.md');
    assert.match(page, /^---\ntitle: "Acme — Cloud Native Platform"\n/);
    assert.match(page, /sidebar_label: "Acme Corp"/);
    assert.match(
      page,
      /import CNCFProjectCard from '@site\/src\/components\/CNCFProjectCard';/,
    );
    assert.match(page, new RegExp(`Source revision: \`${FAKE_COMMIT}\``));
    assert.match(page, /Acme runs a multi-region platform on Kubernetes\./);
  } finally {
    run.cleanup();
  }
});

test('derives title and organization when frontmatter is absent or partial', () => {
  const run = runImportArchitectures({
    upstream: {
      ...architecture('no-frontmatter', 'Just a body paragraph.\n'),
      ...architecture(
        'dashed',
        `---
title: "Globex - Edge Fleet"
---

Globex runs edge clusters.
`,
      ),
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const bare = run.readJson('data/architectures/records/no-frontmatter.json');
    assert.equal(bare.title, 'no-frontmatter');
    assert.equal(bare.organization, 'no');
    assert.deepEqual(bare.industries, []);
    assert.deepEqual(bare.tags, []);

    const dashed = run.readJson('data/architectures/records/dashed.json');
    assert.equal(dashed.title, 'Globex - Edge Fleet');
    assert.equal(dashed.organization, 'Globex');
  } finally {
    run.cleanup();
  }
});

test('normalizes scalar industries and tags into lists', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'scalar',
      `---
title: Scalar
org_name: Scalar Inc
industries: Finance
tags: observability
---

Scalar body.
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/scalar.json');
    assert.deepEqual(record.industries, ['Finance']);
    assert.deepEqual(record.tags, ['observability']);
  } finally {
    run.cleanup();
  }
});

test('sorts catalog records by organization', () => {
  const upstream = {};
  for (const [id, org] of [
    ['zeta', 'Zeta Systems'],
    ['alpha', 'Alpha Labs'],
    ['mid', 'Midway Co'],
  ]) {
    Object.assign(
      upstream,
      architecture(
        id,
        `---\ntitle: ${org}\norg_name: ${org}\n---\n\nBody for ${org}.\n`,
      ),
    );
  }
  const run = runImportArchitectures({ upstream });

  try {
    assert.equal(run.status, 0, run.stderr);
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.deepEqual(
      catalog.map((record) => record.organization),
      ['Alpha Labs', 'Midway Co', 'Zeta Systems'],
    );
  } finally {
    run.cleanup();
  }
});

test('renders card shortcodes as CNCFProjectCard elements and mirrors logos', () => {
  const logoUrl =
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/kubernetes/icon/color/kubernetes-icon-color.svg';
  const run = runImportArchitectures({
    upstream: architecture(
      'cards',
      `---
title: Cards
org_name: Cards Co
---

Intro paragraph for cards.

{{< card header="Kubernetes" >}}
![Kubernetes](${logoUrl})
[Project page](https://www.cncf.io/projects/kubernetes/)
**Using since:** 2019
**Current version:** 1.30
Container orchestration for the fleet.
{{< /card >}}
`,
    ),
    fetchResponses: {
      [logoUrl]: { status: 200, body: '<svg></svg>' },
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/cards.json');
    assert.deepEqual(record.projects, ['Kubernetes']);

    const page = run.read('docs/architectures/cards.md');
    assert.match(page, /<CNCFProjectCard name="Kubernetes"/);
    assert.match(
      page,
      /href="https:\/\/www\.cncf\.io\/projects\/kubernetes\/"/,
    );
    assert.match(
      page,
      /logo="\/img\/cncf-projects\/kubernetes-kubernetes-icon-color\.svg"/,
    );
    assert.match(page, /since="2019"/);
    assert.match(page, /version="1\.30"/);
    assert.match(page, /description="Container orchestration for the fleet\."/);

    assert.equal(
      run.read('static/img/cncf-projects/kubernetes-kubernetes-icon-color.svg'),
      '<svg></svg>',
    );
  } finally {
    run.cleanup();
  }
});

test('falls back to a derived project href when no cncf.io link is present', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'fallback',
      `---
title: Fallback
org_name: Fallback Co
---

Intro paragraph.

{{< card header="Cloud Native Buildpacks" >}}
A build tool.
{{< /card >}}
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/fallback.md');
    assert.match(
      page,
      /href="https:\/\/www\.cncf\.io\/projects\/cloud-native-buildpacks\/"/,
    );
    assert.doesNotMatch(page, /logo=/);
    assert.doesNotMatch(page, /since=/);
  } finally {
    run.cleanup();
  }
});

test('warns but still succeeds when a project asset cannot be mirrored', () => {
  const logoUrl =
    'https://raw.githubusercontent.com/cncf/artwork/main/projects/envoy/icon/color/envoy-icon-color.svg';
  const run = runImportArchitectures({
    upstream: architecture(
      'offline',
      `---
title: Offline
org_name: Offline Co
---

Intro paragraph.

{{< card header="Envoy" >}}
![Envoy](${logoUrl})
{{< /card >}}
`,
    ),
    fetchResponses: { [logoUrl]: { status: 503 } },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stderr,
      /Could not mirror CNCF project asset: projects\/envoy\/icon\/color\/envoy-icon-color\.svg/,
    );
    assert.equal(
      run.exists('static/img/cncf-projects/envoy-envoy-icon-color.svg'),
      false,
    );
    // The card still points at the mirrored path so a later asset sync can fix it.
    assert.match(
      run.read('docs/architectures/offline.md'),
      /logo="\/img\/cncf-projects\/envoy-envoy-icon-color\.svg"/,
    );
  } finally {
    run.cleanup();
  }
});

test('copies architecture images and rewrites relative image links', () => {
  const run = runImportArchitectures({
    upstream: {
      ...architecture(
        'images',
        `---
title: Images
org_name: Images Co
---

Intro paragraph for images.

![Overview](./images/overview.png)

![Nested](images/nested/detail.png)
`,
      ),
      'content/en/architectures/images/images/overview.png': 'overview-bytes',
      'content/en/architectures/images/images/nested/detail.png':
        'detail-bytes',
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/images.json');
    assert.deepEqual(record.assets.sort(), [
      '/img/architectures/images/nested/detail.png',
      '/img/architectures/images/overview.png',
    ]);
    assert.equal(
      run.read('static/img/architectures/images/overview.png'),
      'overview-bytes',
    );
    assert.equal(
      run.read('static/img/architectures/images/nested/detail.png'),
      'detail-bytes',
    );

    const page = run.read('docs/architectures/images.md');
    assert.match(
      page,
      /!\[Overview\]\(\/img\/architectures\/images\/overview\.png\)/,
    );
    assert.match(
      page,
      /!\[Nested\]\(\/img\/architectures\/images\/nested\/detail\.png\)/,
    );
  } finally {
    run.cleanup();
  }
});

test('keeps remote images that are not CNCF project logos as plain links', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'remote',
      `---
title: Remote
org_name: Remote Co
---

Intro paragraph.

![Diagram](https://example.com/diagram.png)
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/remote.md');
    assert.match(page, /\[Diagram\]\(https:\/\/example\.com\/diagram\.png\)/);
    assert.doesNotMatch(page, /!\[Diagram\]\(https:\/\/example\.com/);
  } finally {
    run.cleanup();
  }
});

test('sanitizes imported SVG assets', () => {
  const svg = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" content="&lt;mxfile&gt;"><rect /></svg>`;
  const run = runImportArchitectures({
    upstream: {
      ...architecture(
        'svg',
        '---\ntitle: Svg\norg_name: Svg Co\n---\n\nIntro paragraph.\n',
      ),
      'content/en/architectures/svg/images/diagram.svg': svg,
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const sanitized = run.read('static/img/architectures/svg/diagram.svg');
    assert.doesNotMatch(sanitized, /DOCTYPE/);
    assert.doesNotMatch(sanitized, /content=/);
    assert.match(sanitized, /<svg viewBox="0 0 640 480"/);
  } finally {
    run.cleanup();
  }
});

test('leaves SVGs untouched when a viewBox is already present', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect /></svg>';
  const run = runImportArchitectures({
    upstream: {
      ...architecture(
        'viewbox',
        '---\ntitle: Viewbox\norg_name: Viewbox Co\n---\n\nIntro paragraph.\n',
      ),
      'content/en/architectures/viewbox/images/keep.svg': svg,
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.read('static/img/architectures/viewbox/keep.svg'), svg);
  } finally {
    run.cleanup();
  }
});

test('summary skips headings and images and collapses emphasis', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'summary',
      `---
title: Summary
org_name: Summary Co
---

# Heading first

![Leading image](https://example.com/a.png)

**Bold** intro with \`code\` and
a wrapped line.

Second paragraph is ignored.
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/summary.json');
    assert.equal(record.summary, 'Bold intro with code and a wrapped line.');
  } finally {
    run.cleanup();
  }
});

test('truncates long summaries to 240 characters', () => {
  const long = 'word '.repeat(120).trim();
  const run = runImportArchitectures({
    upstream: architecture(
      'long',
      `---\ntitle: Long\norg_name: Long Co\n---\n\n${long}\n`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/long.json');
    assert.equal(record.summary.length, 240);
  } finally {
    run.cleanup();
  }
});

test('strips leftover shortcodes and escapes bare angle brackets', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'shortcodes',
      `---
title: Shortcodes
org_name: Shortcodes Co
---

Intro paragraph.

{{< note >}}Hugo only{{< /note >}}

A diamond <> operator.
`,
    ),
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/shortcodes.md');
    assert.doesNotMatch(page, /{{</);
    assert.match(page, /A diamond &lt;&gt; operator\./);
  } finally {
    run.cleanup();
  }
});

test('removes stale records, docs pages and assets before importing', () => {
  const run = runImportArchitectures({
    upstream: architecture(
      'kept',
      '---\ntitle: Kept\norg_name: Kept Co\n---\n\nIntro paragraph.\n',
    ),
    repoFiles: {
      'data/architectures/records/stale.json': '{"id":"stale"}',
      'docs/architectures/kept.md': 'stale page body',
      'docs/architectures/reports/old-report.md': 'stale report',
      'static/img/architectures/stale/old.png': 'stale bytes',
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.exists('data/architectures/records/stale.json'), false);
    assert.equal(run.exists('docs/architectures/reports/old-report.md'), false);
    assert.equal(run.exists('static/img/architectures/stale/old.png'), false);
    assert.match(run.read('docs/architectures/kept.md'), /Intro paragraph\./);
  } finally {
    run.cleanup();
  }
});

const rasterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><image href="data:image/png;base64,AAAA" /></svg>`;

test('converts raster-embedded SVGs to PNG when a renderer is available', () => {
  const run = runImportArchitectures({
    upstream: {
      ...architecture(
        'raster',
        '---\ntitle: Raster\norg_name: Raster Co\n---\n\nIntro paragraph.\n',
      ),
      'content/en/architectures/raster/images/embedded.svg': rasterSvg,
    },
    rsvgConvert: 'success',
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.exists('static/img/architectures/raster/embedded.svg'),
      false,
    );
    assert.equal(
      run.read('static/img/architectures/raster/embedded.png'),
      'converted-png',
    );
    assert.match(
      run.stdout,
      /Converted raster-embedded SVG to PNG: img\/architectures\/raster\/embedded\.png/,
    );
  } finally {
    run.cleanup();
  }
});

test('keeps the SVG and warns when the renderer is unavailable', () => {
  const run = runImportArchitectures({
    upstream: {
      ...architecture(
        'raster-warn',
        '---\ntitle: Raster Warn\norg_name: Raster Warn Co\n---\n\nIntro paragraph.\n',
      ),
      'content/en/architectures/raster-warn/images/embedded.svg': rasterSvg,
    },
    rsvgConvert: 'failure',
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.exists('static/img/architectures/raster-warn/embedded.png'),
      false,
    );
    assert.match(
      run.stderr,
      /Could not convert raster-embedded SVG; consider installing rsvg-convert: img\/architectures\/raster-warn\/embedded\.svg/,
    );
  } finally {
    run.cleanup();
  }
});

// Upstream is third-party input. A symbolic link in images/ used to be walked
// as if it were a regular file: copied into static/ verbatim as a link, then
// read through and written back through during SVG sanitization, which turns
// an upstream link into an arbitrary file read and write on the CI runner.
test('does not mirror or write through a symlinked upstream asset', () => {
  const outside = mkdtempSync(join(tmpdir(), 'endusers-link-target-'));
  const secret = join(outside, 'secret.svg');
  writeFileSync(secret, '<svg>original</svg>', 'utf8');

  const run = runImportArchitectures({
    upstream: architecture('linked', '---\ntitle: Linked\n---\n\nBody.\n'),
    upstreamSymlinks: {
      'content/en/architectures/linked/images/diagram.svg': secret,
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.exists('static/img/architectures/linked/diagram.svg'),
      false,
      'symlinked asset must not be mirrored into static/',
    );
    assert.deepEqual(
      run.readJson('data/architectures/records/linked.json').assets,
      [],
    );
    assert.equal(
      readFileSync(secret, 'utf8'),
      '<svg>original</svg>',
      'sanitization must not write through the link to its target',
    );
    assert.match(run.stderr, /Skipping symbolic link diagram\.svg/);
  } finally {
    run.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test('does not follow a symlinked images directory', () => {
  const outside = mkdtempSync(join(tmpdir(), 'endusers-link-dir-'));
  writeFileSync(join(outside, 'leaked.png'), 'secret-bytes');

  const run = runImportArchitectures({
    upstream: architecture('linkdir', '---\ntitle: Link Dir\n---\n\nBody.\n'),
    upstreamSymlinks: {
      'content/en/architectures/linkdir/images': outside,
    },
  });

  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.exists('static/img/architectures/linkdir/leaked.png'),
      false,
    );
    assert.deepEqual(
      run.readJson('data/architectures/records/linkdir.json').assets,
      [],
    );
    assert.match(run.stderr, /Skipping images\/ in linkdir/);
  } finally {
    run.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
