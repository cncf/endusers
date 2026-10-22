import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertLandscapeSnapshotReady,
  buildLandscapeSnapshot,
  mirrorLandscapeLogo,
  publishLandscapeSnapshot,
} from '../scripts/lib/enduser-collector.mjs';

const RECORD = {
  sourceId: 'cncf/landscape#CNCF Members/Gold/Acme (member)',
  sourceRole: 'member',
  included: true,
  classificationReason: 'selected-member',
  sourceName: 'Acme (member)',
  displayName: 'Acme',
  category: 'CNCF Members',
  subcategory: 'Gold',
  enduser: true,
  homepageUrl: 'https://example.test/acme',
  joined: '2026-01-01',
  logoFilename: 'acme.svg',
};

function withRoots(run) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-collector-test-'));
  const sourceRoot = join(root, 'landscape');
  const destinationRoot = join(root, 'static/img/end-user-members');
  mkdirSync(join(sourceRoot, 'hosted_logos'), { recursive: true });
  mkdirSync(destinationRoot, { recursive: true });
  try {
    run({ root, sourceRoot, destinationRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('mirrors and sanitizes a local landscape SVG', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect /></svg>',
    );
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.match(result.localLogo, /^\/img\/end-user-members\//);
    assert.equal(result.logoWarning, null);
    const file = join(destinationRoot, result.localLogo.split('/').pop());
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<script/i);
  });
});

test('refreshes a changed logo for the same source ID and filename', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const logo = join(sourceRoot, 'hosted_logos/acme.svg');
    writeFileSync(
      logo,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="old" /></svg>',
    );
    const first = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    writeFileSync(
      logo,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="new" /></svg>',
    );
    const second = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.notEqual(first.localLogo, second.localLogo);
    assert.match(
      readFileSync(
        join(destinationRoot, second.localLogo.split('/').pop()),
        'utf8',
      ),
      /id="new"/,
    );
  });
});

test('updates an existing content-addressed file and rejects a destination directory', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const logo = join(sourceRoot, 'hosted_logos/acme.svg');
    writeFileSync(
      logo,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="same" /></svg>',
    );
    const first = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    const firstPath = join(destinationRoot, first.localLogo.split('/').pop());
    writeFileSync(firstPath, 'different');
    const updated = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(updated.localLogo, first.localLogo);
    assert.match(readFileSync(firstPath, 'utf8'), /id="same"/);

    rmSync(firstPath, { force: true });
    mkdirSync(firstPath);
    const failed = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.match(failed.logoWarning, /destination is not a regular file/);
  });
});

test('keeps an organization when its optional logo is unavailable', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(result.localLogo, null);
    assert.match(result.logoWarning, /symlink or is missing/);
    assert.equal(result.sourceId, RECORD.sourceId);
  });
});

test('rejects a logo that would fetch remote resources', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/pixel" /></svg>',
    );
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(result.localLogo, null);
    assert.match(result.logoWarning, /remote resource references/);
  });
});

test('rejects a logo whose markup is split by a DOCTYPE', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    // A DOCTYPE inside a tag name is not well-formed XML, so the parse rejects
    // it; nothing is ever deleted to splice "<sc" onto "ript>".
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<sc<!DOCTYPE d>ript>alert(1)</script></svg>',
    );
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(result.localLogo, null);
    assert.match(result.logoWarning, /is not well-formed XML/);
    assert.deepEqual(readdirSync(destinationRoot), []);
  });
});

test('rejects a logo with a DOCTYPE that cannot be removed', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    // An unclosed internal subset is not well-formed, and a parser that
    // swallows it would otherwise certify the markup it hides.
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<!DOCTYPE svg [\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>',
    );
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(result.localLogo, null);
    assert.match(
      result.logoWarning,
      /is not well-formed XML \(Unterminated DOCTYPE\)/,
    );
    assert.deepEqual(readdirSync(destinationRoot), []);
  });
});

test('keeps records with no logo and rejects unsafe logo filenames', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const noLogo = mirrorLandscapeLogo({
      record: { ...RECORD, logoFilename: null },
      sourceRoot,
      destinationRoot,
    });
    assert.equal(noLogo.localLogo, null);
    assert.equal(noLogo.logoWarning, null);

    const unsafe = mirrorLandscapeLogo({
      record: { ...RECORD, logoFilename: '../acme.svg' },
      sourceRoot,
      destinationRoot,
    });
    assert.equal(unsafe.localLogo, null);
    assert.match(unsafe.logoWarning, /unsafe logo filename/);
  });
});

test('rejects a supporter-only upstream snapshot before publication', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    assert.throws(
      () =>
        buildLandscapeSnapshot({
          document: {
            landscape: [
              {
                name: 'CNCF Members',
                subcategories: [
                  { name: 'Gold', items: [] },
                  {
                    name: 'End User Supporter and Contributor',
                    items: [
                      {
                        name: 'Legacy (supporter)',
                        homepage_url: 'https://example.test/legacy',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
          collectedAt: '2026-10-01T00:00:00.000Z',
          sourceRoot,
          destinationRoot,
        }),
      /no current Member\/Contributor records/,
    );
  });
});

test('rejects symlinked logo files and hosted-logo directories', () => {
  withRoots(({ root, sourceRoot, destinationRoot }) => {
    const outside = join(root, 'outside.png');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(sourceRoot, 'hosted_logos/acme.png'));
    const fileResult = mirrorLandscapeLogo({
      record: { ...RECORD, logoFilename: 'acme.png' },
      sourceRoot,
      destinationRoot,
    });
    assert.equal(fileResult.localLogo, null);
    assert.match(fileResult.logoWarning, /symlink/);
    assert.equal(existsSync(join(destinationRoot, 'acme.png')), false);

    const outsideDirectory = join(root, 'outside-directory');
    mkdirSync(outsideDirectory);
    rmSync(join(sourceRoot, 'hosted_logos'), {
      recursive: true,
      force: true,
    });
    symlinkSync(outsideDirectory, join(sourceRoot, 'hosted_logos'), 'dir');
    const directoryResult = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(directoryResult.localLogo, null);
    assert.match(directoryResult.logoWarning, /not a real directory/);
  });
});

test('reports unsafe snapshot classifications before publication', () => {
  const base = {
    generated: true,
    source: {
      revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
      sourceUrl:
        'https://github.com/cncf/landscape/blob/bc9d1b5c87904d9430fc3377938f38192bab3ad0/landscape.yml',
    },
    records: [
      {
        sourceId: 'source',
        sourceRole: 'member',
        included: true,
        logoFilename: null,
      },
    ],
  };
  assert.doesNotThrow(() => assertLandscapeSnapshotReady(base));
  assert.doesNotThrow(() =>
    assertLandscapeSnapshotReady({
      ...base,
      records: [{ ...base.records[0], sourceRole: 'contributor' }],
    }),
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        records: [base.records[0], { ...base.records[0] }],
      }),
    /duplicate landscape sourceId/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        generated: false,
      }),
    /not marked generated/,
  );
  assert.throws(
    () => assertLandscapeSnapshotReady(undefined),
    /not marked generated/,
  );
  assert.throws(
    () => assertLandscapeSnapshotReady(null),
    /not marked generated/,
  );
  // Each provenance case below holds the other two arms of the condition
  // satisfied, so exactly one reason to reject the snapshot remains: a case
  // that trips several arms at once only proves that something rejected it.
  // pinnedSource() derives the sourceUrl from the revision under test, which
  // keeps the sourceUrl arm satisfied for every revision-shape case.
  const pinnedSource = (revision) => ({
    revision,
    sourceUrl: `https://github.com/cncf/landscape/blob/${revision}/landscape.yml`,
  });
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: undefined,
      }),
    /source provenance is incomplete/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: pinnedSource(42),
      }),
    /source provenance is incomplete/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: pinnedSource('bad'),
      }),
    /source provenance is incomplete/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: pinnedSource('g'.repeat(40)),
      }),
    /source provenance is incomplete/,
  );
  // 41 hex characters: the revision is rejected only because the pattern is
  // anchored at the end.
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: pinnedSource(`${'a'.repeat(40)}b`),
      }),
    /source provenance is incomplete/,
  );
  // 40 hex characters behind a non-hex prefix: rejected only because the
  // pattern is anchored at the start.
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: pinnedSource(`z${'a'.repeat(40)}`),
      }),
    /source provenance is incomplete/,
  );
  // A well-formed revision paired with a sourceUrl that does not derive from
  // it: rejected only by the sourceUrl arm.
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: {
          revision: base.source.revision,
          sourceUrl:
            'https://github.com/cncf/landscape/blob/main/landscape.yml',
        },
      }),
    /source provenance is incomplete/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        records: [],
      }),
    /no current Member\/Contributor records/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        records: 'not-an-array',
      }),
    /no current Member\/Contributor records/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        records: [{ ...base.records[0], sourceRole: 'supporter' }],
      }),
    /invalid current role/,
  );
  assert.throws(
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        records: [
          { ...base.records[0], logoFilename: 'logo.svg', localLogo: null },
        ],
      }),
    /no logo or logo warning/,
  );
});
test('mirrors supported raster assets and reports write failures', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    writeFileSync(join(sourceRoot, 'hosted_logos/acme.png'), 'png');
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
    );
    const raster = mirrorLandscapeLogo({
      record: { ...RECORD, logoFilename: 'acme.png' },
      sourceRoot,
      destinationRoot,
    });
    assert.match(raster.localLogo, /\.png$/);

    const destinationFile = join(sourceRoot, 'destination-file');
    writeFileSync(destinationFile, 'not a directory');
    const failed = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot: destinationFile,
    });
    assert.equal(failed.localLogo, null);
    assert.match(failed.logoWarning, /could not mirror logo/);
  });
});

test('reports missing, non-file, containment, and inspection failures', () => {
  withRoots(({ root, sourceRoot, destinationRoot }) => {
    const missingRoot = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot: join(root, 'missing'),
      destinationRoot,
    });
    assert.match(missingRoot.logoWarning, /not a real directory/);

    mkdirSync(join(sourceRoot, 'hosted_logos/acme.svg'));
    const nonFile = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.match(nonFile.logoWarning, /not a regular file/);

    rmSync(join(sourceRoot, 'hosted_logos/acme.svg'), {
      recursive: true,
      force: true,
    });
    writeFileSync(join(sourceRoot, 'hosted_logos/acme.svg'), '<svg />');
    const outside = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
      realpath: (path) =>
        path === sourceRoot ? path : join(root, '..', 'outside.svg'),
    });
    assert.match(outside.logoWarning, /outside the checkout/);

    const inspected = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
      realpath: () => {
        throw new Error('realpath failed');
      },
    });
    assert.match(inspected.logoWarning, /could not inspect/);
  });
});

test('builds a pinned snapshot and preserves audit-only records', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
    );
    const snapshot = buildLandscapeSnapshot({
      document: {
        landscape: [
          {
            name: 'CNCF Members',
            subcategories: [
              {
                name: 'Gold',
                items: [
                  {
                    name: 'Acme (member)',
                    enduser: true,
                    homepage_url: 'https://example.test/acme',
                    logo: 'acme.svg',
                    joined: '2026-01-01',
                  },
                ],
              },
              {
                name: 'End User Supporter and Contributor',
                items: [
                  {
                    name: 'Legacy (supporter)',
                    homepage_url: 'https://example.test/legacy',
                    logo: 'legacy.svg',
                    joined: '2020-01-01',
                  },
                ],
              },
            ],
          },
        ],
      },
      revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
      collectedAt: '2026-10-01T00:00:00.000Z',
      sourceRoot,
      destinationRoot,
    });
    assert.equal(snapshot.records.length, 2);
    assert.equal(snapshot.records[0].included, true);
    assert.equal(snapshot.records[1].included, false);
    assert.equal(snapshot.source.revision.length, 40);
  });
});

test('rolls back the old snapshot and assets when publication rename fails', () => {
  withRoots(({ root, destinationRoot }) => {
    const outputPath = join(root, 'data/members.json');
    const outputTempPath = join(root, 'staged-members.json');
    const stagedAssets = join(root, 'staged-assets');
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(stagedAssets, { recursive: true });
    writeFileSync(outputPath, '{"old":true}\n');
    writeFileSync(join(destinationRoot, 'aaaaaaaaaaaaaaaa-old.svg'), 'old');
    writeFileSync(join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');

    const snapshot = {
      generated: true,
      source: {
        revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
        sourceUrl:
          'https://github.com/cncf/landscape/blob/bc9d1b5c87904d9430fc3377938f38192bab3ad0/landscape.yml',
      },
      records: [
        {
          sourceId: 'source',
          sourceRole: 'member',
          included: true,
          logoFilename: 'new.svg',
          localLogo: '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg',
          logoWarning: null,
        },
      ],
    };

    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot,
          stagedAssets,
          outputTempPath,
          outputPath,
          assetDestination: destinationRoot,
        }),
      /ENOENT/,
    );
    assert.equal(readFileSync(outputPath, 'utf8'), '{"old":true}\n');
    assert.equal(
      readFileSync(join(destinationRoot, 'aaaaaaaaaaaaaaaa-old.svg'), 'utf8'),
      'old',
    );
    assert.equal(
      existsSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg')),
      false,
    );
  });
});

test('publishes successfully without pruning before generation', () => {
  withRoots(({ root, destinationRoot }) => {
    const outputPath = join(root, 'data/members.json');
    const outputTempPath = join(root, 'staged-members.json');
    const stagedAssets = join(root, 'staged-assets');
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(stagedAssets, { recursive: true });
    writeFileSync(outputPath, '{"old":true}\n');
    writeFileSync(join(destinationRoot, 'aaaaaaaaaaaaaaaa-old.svg'), 'old');
    writeFileSync(join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');
    writeFileSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');
    writeFileSync(outputTempPath, '{"new":true}\n');
    const snapshot = {
      generated: true,
      source: {
        revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
        sourceUrl:
          'https://github.com/cncf/landscape/blob/bc9d1b5c87904d9430fc3377938f38192bab3ad0/landscape.yml',
      },
      records: [
        {
          sourceId: 'source',
          sourceRole: 'member',
          included: true,
          logoFilename: 'new.svg',
          localLogo: '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg',
          logoWarning: null,
        },
      ],
    };

    publishLandscapeSnapshot({
      snapshot,
      stagedAssets,
      outputTempPath,
      outputPath,
      assetDestination: destinationRoot,
    });
    assert.equal(readFileSync(outputPath, 'utf8'), '{"new":true}\n');
    assert.equal(
      readFileSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'), 'utf8'),
      'new',
    );
    assert.equal(
      existsSync(join(destinationRoot, 'aaaaaaaaaaaaaaaa-old.svg')),
      true,
    );
  });
});

test('rejects staged and destination symlink assets during publication', () => {
  withRoots(({ root, destinationRoot }) => {
    const outputPath = join(root, 'data/members.json');
    const outputTempPath = join(root, 'staged-members.json');
    const stagedAssets = join(root, 'staged-assets');
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(stagedAssets, { recursive: true });
    writeFileSync(outputPath, '{"old":true}\n');
    writeFileSync(outputTempPath, '{"new":true}\n');
    const outside = join(root, 'outside.svg');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'));
    const snapshot = {
      generated: true,
      source: {
        revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
        sourceUrl:
          'https://github.com/cncf/landscape/blob/bc9d1b5c87904d9430fc3377938f38192bab3ad0/landscape.yml',
      },
      records: [
        {
          sourceId: 'source',
          sourceRole: 'member',
          included: true,
          logoFilename: 'new.svg',
          localLogo: '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg',
          logoWarning: null,
        },
      ],
    };
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot,
          stagedAssets,
          outputTempPath,
          outputPath,
          assetDestination: destinationRoot,
        }),
      /staged asset is not a regular file/,
    );

    rmSync(join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'), {
      force: true,
    });
    writeFileSync(join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');
    symlinkSync(outside, join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'));
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot,
          stagedAssets,
          outputTempPath,
          outputPath,
          assetDestination: destinationRoot,
        }),
      /owned asset destination is a symlink/,
    );

    rmSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'), {
      force: true,
    });
    mkdirSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'));
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot,
          stagedAssets,
          outputTempPath,
          outputPath,
          assetDestination: destinationRoot,
        }),
      /owned asset destination is not a regular file/,
    );
  });
});

test('rejects differing bytes at an existing content-addressed destination', () => {
  withRoots(({ root, destinationRoot }) => {
    const outputPath = join(root, 'data/members.json');
    const outputTempPath = join(root, 'staged-members.json');
    const stagedAssets = join(root, 'staged-assets');
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(stagedAssets, { recursive: true });
    writeFileSync(outputPath, '{"old":true}\n');
    writeFileSync(outputTempPath, '{"new":true}\n');
    writeFileSync(join(stagedAssets, 'bbbbbbbbbbbbbbbb-new.svg'), 'new');
    writeFileSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'), 'old');
    const snapshot = {
      generated: true,
      source: {
        revision: 'bc9d1b5c87904d9430fc3377938f38192bab3ad0',
        sourceUrl:
          'https://github.com/cncf/landscape/blob/bc9d1b5c87904d9430fc3377938f38192bab3ad0/landscape.yml',
      },
      records: [
        {
          sourceId: 'source',
          sourceRole: 'member',
          included: true,
          logoFilename: 'new.svg',
          localLogo: '/img/end-user-members/bbbbbbbbbbbbbbbb-new.svg',
          logoWarning: null,
        },
      ],
    };
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot,
          stagedAssets,
          outputTempPath,
          outputPath,
          assetDestination: destinationRoot,
        }),
      /owned asset destination bytes differ/,
    );
    assert.equal(readFileSync(outputPath, 'utf8'), '{"old":true}\n');
    assert.equal(
      readFileSync(join(destinationRoot, 'bbbbbbbbbbbbbbbb-new.svg'), 'utf8'),
      'old',
    );
  });
});

const REVISION = 'bc9d1b5c87904d9430fc3377938f38192bab3ad0';

function publishedSnapshot(records) {
  return {
    generated: true,
    source: {
      revision: REVISION,
      sourceUrl: `https://github.com/cncf/landscape/blob/${REVISION}/landscape.yml`,
    },
    records,
  };
}

function publishPaths(root) {
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    outputPath: join(dataDir, 'members.json'),
    outputTempPath: join(root, 'staged-members.json'),
    stagedAssets: join(root, 'staged-assets'),
  };
}

const NEW_ASSET = 'bbbbbbbbbbbbbbbb-new.svg';
const NEW_RECORD = {
  sourceId: 'source',
  sourceRole: 'member',
  included: true,
  logoFilename: 'new.svg',
  localLogo: `/img/end-user-members/${NEW_ASSET}`,
  logoWarning: null,
};

// The mirrored name is the first 16 hex characters of the SHA-256 of the
// bytes written, so a reader can verify the file against its name, and the
// bytes are the sanitized source with trailing whitespace removed from every
// line and from the end of the file.
test('names the mirrored logo after the sanitized bytes it writes', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    writeFileSync(
      join(sourceRoot, 'hosted_logos/acme.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg">  \n  <rect />\t\n</svg>\n\n',
    );
    const expected =
      '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect />\n</svg>';
    const digest = createHash('sha256').update(expected).digest('hex');
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.deepEqual(result, {
      ...RECORD,
      localLogo: `/img/end-user-members/${digest.slice(0, 16)}-acme.svg`,
      logoWarning: null,
    });
    const file = join(destinationRoot, `${digest.slice(0, 16)}-acme.svg`);
    assert.equal(readFileSync(file, 'utf8'), expected);

    // An identical destination is left alone rather than rewritten.
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, past, past);
    mirrorLandscapeLogo({ record: RECORD, sourceRoot, destinationRoot });
    assert.equal(statSync(file).mtime.getTime(), past.getTime());
  });
});

test('reports a hosted_logos directory that is missing or is a file', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const logoRoot = join(sourceRoot, 'hosted_logos');
    const expected = `${RECORD.sourceId}: landscape hosted_logos is not a real directory`;
    rmSync(logoRoot, { recursive: true, force: true });
    for (const prepare of [() => {}, () => writeFileSync(logoRoot, 'file')]) {
      prepare();
      const result = mirrorLandscapeLogo({
        record: RECORD,
        sourceRoot,
        destinationRoot,
      });
      assert.equal(result.localLogo, null);
      assert.equal(result.logoWarning, expected);
    }
  });
});

// The provenance and selection blocks are what downstream readers and
// reviewers see in the committed snapshot, so they are pinned verbatim.
test('records the landscape provenance and selection rules verbatim', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const snapshot = buildLandscapeSnapshot({
      document: {
        landscape: [
          {
            name: 'CNCF Members',
            subcategories: [
              {
                name: 'Gold',
                items: [{ name: 'Acme (member)', enduser: true }],
              },
              { name: 'End User Supporter and Contributor', items: [] },
            ],
          },
        ],
      },
      revision: REVISION,
      collectedAt: '2026-10-01T00:00:00.000Z',
      sourceRoot,
      destinationRoot,
    });
    assert.deepEqual(snapshot.source, {
      repository: 'https://github.com/cncf/landscape',
      revision: REVISION,
      file: 'landscape.yml',
      sourceUrl: `https://github.com/cncf/landscape/blob/${REVISION}/landscape.yml`,
    });
    assert.deepEqual(snapshot.selection, {
      member: 'CNCF Members item.enduser === true and name suffix "(member)"',
      contributor:
        'CNCF Members / End User Supporter and Contributor name suffix "(contributor)"',
      supporter: 'audit-only',
    });
    assert.equal(snapshot.collectedAt, '2026-10-01T00:00:00.000Z');
  });
});

test('refuses to publish a snapshot that fails the readiness gate', () => {
  withRoots(({ root, destinationRoot }) => {
    const paths = publishPaths(root);
    writeFileSync(paths.outputTempPath, '{"new":true}\n');
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot: { ...publishedSnapshot([NEW_RECORD]), generated: false },
          ...paths,
          assetDestination: destinationRoot,
        }),
      /not marked generated/,
    );
    assert.equal(existsSync(paths.outputPath), false);
  });
});

// First publication: no previous output to back up and no staged assets
// directory at all. Then a second run moves a new asset into place and leaves
// no backup behind.
test('publishes a first snapshot and moves new assets without leaving a backup', () => {
  withRoots(({ root, destinationRoot }) => {
    const paths = publishPaths(root);
    const publish = () =>
      publishLandscapeSnapshot({
        snapshot: publishedSnapshot([NEW_RECORD]),
        ...paths,
        assetDestination: destinationRoot,
      });

    writeFileSync(paths.outputTempPath, '{"first":true}\n');
    publish();
    assert.equal(readFileSync(paths.outputPath, 'utf8'), '{"first":true}\n');
    assert.deepEqual(readdirSync(paths.dataDir), ['members.json']);

    mkdirSync(paths.stagedAssets);
    writeFileSync(join(paths.stagedAssets, NEW_ASSET), 'new');
    writeFileSync(paths.outputTempPath, '{"second":true}\n');
    publish();
    assert.equal(readFileSync(paths.outputPath, 'utf8'), '{"second":true}\n');
    assert.equal(readFileSync(join(destinationRoot, NEW_ASSET), 'utf8'), 'new');
    assert.deepEqual(readdirSync(paths.stagedAssets), []);
    assert.deepEqual(readdirSync(paths.dataDir), ['members.json']);
  });
});

// A staged directory is not a regular file either, and a failure before any
// output exists must surface its own error rather than one from restoring a
// backup that was never taken.
test('rejects a staged directory and reports the original failure without a prior output', () => {
  withRoots(({ root, destinationRoot }) => {
    const paths = publishPaths(root);
    mkdirSync(join(paths.stagedAssets, 'nested-dir'), { recursive: true });
    writeFileSync(paths.outputTempPath, '{"new":true}\n');
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot: publishedSnapshot([NEW_RECORD]),
          ...paths,
          assetDestination: destinationRoot,
        }),
      new Error('staged asset is not a regular file: nested-dir'),
    );
    assert.equal(existsSync(join(destinationRoot, 'nested-dir')), false);
    assert.deepEqual(readdirSync(paths.dataDir), []);
  });
});

test('removes the output backup after a failed publication is rolled back', () => {
  withRoots(({ root, destinationRoot }) => {
    const paths = publishPaths(root);
    writeFileSync(paths.outputPath, '{"old":true}\n');
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot: publishedSnapshot([NEW_RECORD]),
          ...paths,
          assetDestination: destinationRoot,
        }),
      /ENOENT/,
    );
    assert.equal(readFileSync(paths.outputPath, 'utf8'), '{"old":true}\n');
    assert.deepEqual(readdirSync(paths.dataDir), ['members.json']);
  });
});

// The previous output is backed up before anything moves. A directory sitting
// at the output path cannot be copied, so the failure is the backup copy's own
// and arrives before any staged asset has been renamed: the staged file is
// still where it was, nothing reached the destination and no backup was left.
// Deferring the backup would instead move the asset first and lose it to the
// rollback, which removes the moved copy without restoring the staged one.
test('backs up the previous output before moving any staged asset', () => {
  withRoots(({ root, destinationRoot }) => {
    const paths = publishPaths(root);
    mkdirSync(paths.outputPath);
    mkdirSync(paths.stagedAssets);
    writeFileSync(join(paths.stagedAssets, NEW_ASSET), 'new');
    writeFileSync(paths.outputTempPath, '{"new":true}\n');
    assert.throws(
      () =>
        publishLandscapeSnapshot({
          snapshot: publishedSnapshot([NEW_RECORD]),
          ...paths,
          assetDestination: destinationRoot,
        }),
      { code: 'EISDIR', syscall: 'copyfile' },
    );
    assert.deepEqual(readdirSync(paths.stagedAssets), [NEW_ASSET]);
    assert.equal(existsSync(join(destinationRoot, NEW_ASSET)), false);
    assert.deepEqual(readdirSync(paths.dataDir), ['members.json']);
  });
});
