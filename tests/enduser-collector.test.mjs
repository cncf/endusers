import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLandscapeSnapshot,
  mirrorLandscapeLogo,
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

test('keeps an organization when its optional logo is unavailable', () => {
  withRoots(({ sourceRoot, destinationRoot }) => {
    const result = mirrorLandscapeLogo({
      record: RECORD,
      sourceRoot,
      destinationRoot,
    });
    assert.equal(result.localLogo, null);
    assert.match(result.logoWarning, /logo is missing/);
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
