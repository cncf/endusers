import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
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
      '<svg><script>alert(1)</script><rect /></svg>',
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
      '<svg><image href="https://evil.example/pixel" /></svg>',
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
    () =>
      assertLandscapeSnapshotReady({
        ...base,
        source: { revision: 'bad', sourceUrl: 'https://example.test/' },
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
