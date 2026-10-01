import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runScriptInSandbox } from './helpers-script-sandbox.mjs';

const SUPPORTER_SUBCATEGORY = 'End User Supporter and Contributor';
const ACME_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const BETA_PNG = 'beta-raster-bytes';

function landscapeYaml({ acmeLogo = 'acme.svg' } = {}) {
  return [
    'landscape:',
    '  - name: CNCF Members',
    '    subcategories:',
    '      - name: Gold',
    '        items:',
    '          - name: Acme (member)',
    '            homepage_url: https://acme.test/',
    `            logo: ${acmeLogo}`,
    '            enduser: true',
    '          - name: Vendor Co (member)',
    '            homepage_url: https://vendor.test/',
    '            logo: vendor.svg',
    `      - name: ${SUPPORTER_SUBCATEGORY}`,
    '        items:',
    '          - name: Beta Co (contributor)',
    '            homepage_url: https://beta.test/',
    '            logo: beta.png',
    '          - name: Legacy Co (supporter)',
    '            homepage_url: https://legacy.test/',
    '            logo: legacy.svg',
    '',
  ].join('\n');
}

function landscapeRepo(overrides = {}) {
  return {
    'landscape.yml': landscapeYaml(),
    'hosted_logos/acme.svg': ACME_SVG,
    'hosted_logos/beta.png': BETA_PNG,
    'hosted_logos/vendor.svg': ACME_SVG,
    'hosted_logos/legacy.svg': ACME_SVG,
    ...overrides,
  };
}

// Mirrors scripts/lib/enduser-collector.mjs logoDestination(): the published
// name is content-addressed, so the test derives it rather than hard-coding a
// digest that would silently drift if the fixture changed.
function mirroredName(content, filename) {
  const digest = createHash('sha256')
    .update(Buffer.from(content, 'utf8'))
    .digest('hex')
    .slice(0, 16);
  return `${digest}-${filename}`;
}

function collect({
  repos = landscapeRepo(),
  fixtures = {},
  outputs = [],
  env = {},
}) {
  return runScriptInSandbox({
    script: 'collect-enduser-members.mjs',
    repos: { landscape: repos },
    fixtures,
    env,
    outputs: ['data/enduser-landscape.json', ...outputs],
  });
}

test('publishes a provenanced snapshot, mirrored logos, and an owned-asset manifest', () => {
  const acmeName = mirroredName(ACME_SVG, 'acme.svg');
  const betaName = mirroredName(BETA_PNG, 'beta.png');
  const result = collect({
    outputs: [
      'data/enduser-landscape-assets.json',
      `static/img/end-user-members/${acmeName}`,
      `static/img/end-user-members/${betaName}`,
    ],
  });

  assert.equal(result.status, 0, result.stderr);

  const snapshot = JSON.parse(result.outputs['data/enduser-landscape.json']);
  assert.equal(snapshot.generated, true);
  assert.match(snapshot.source.revision, /^[0-9a-f]{40}$/);
  assert.equal(
    snapshot.source.sourceUrl,
    `https://github.com/cncf/landscape/blob/${snapshot.source.revision}/landscape.yml`,
  );

  const included = snapshot.records.filter((record) => record.included);
  assert.deepEqual(
    included.map((record) => [record.displayName, record.sourceRole]),
    [
      ['Acme', 'member'],
      ['Beta Co', 'contributor'],
    ],
  );

  // The supporter is audited, not published, and the non-enduser member is
  // dropped entirely — both are selection decisions the entry point must keep.
  assert.deepEqual(
    snapshot.records.map((record) => record.displayName),
    ['Acme', 'Beta Co', 'Legacy Co'],
  );

  assert.deepEqual(
    included.map((record) => record.localLogo),
    [`/img/end-user-members/${acmeName}`, `/img/end-user-members/${betaName}`],
  );
  assert.equal(
    result.outputs[`static/img/end-user-members/${acmeName}`],
    ACME_SVG,
  );
  assert.equal(
    result.outputs[`static/img/end-user-members/${betaName}`],
    BETA_PNG,
  );

  // No manifest and no previous snapshot means nothing is yet collector-owned,
  // so the first run must seed an empty manifest rather than claiming the
  // assets it just published.
  assert.deepEqual(
    JSON.parse(result.outputs['data/enduser-landscape-assets.json']),
    { generated: true, assets: [] },
  );

  assert.match(result.stdout, /Collected 2 selected End User/);
  assert.equal(result.requests.length, 0);
});

test('seeds the owned-asset manifest from the previous snapshot', () => {
  const previous = {
    generated: true,
    collectedAt: '2026-01-01T00:00:00.000Z',
    source: {
      repository: 'https://github.com/cncf/landscape',
      revision: 'a'.repeat(40),
      file: 'landscape.yml',
      sourceUrl: `https://github.com/cncf/landscape/blob/${'a'.repeat(40)}/landscape.yml`,
    },
    records: [
      {
        sourceId: 'cncf/landscape#CNCF Members/Gold/Stale Co (member)',
        displayName: 'Stale Co',
        sourceRole: 'member',
        included: true,
        localLogo: '/img/end-user-members/deadbeefdeadbeef-stale.svg',
        logoWarning: null,
      },
    ],
  };

  const result = collect({
    fixtures: {
      'data/enduser-landscape.json': JSON.stringify(previous, null, 2) + '\n',
    },
    outputs: ['data/enduser-landscape-assets.json'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.outputs['data/enduser-landscape-assets.json']),
    {
      generated: true,
      assets: ['/img/end-user-members/deadbeefdeadbeef-stale.svg'],
    },
  );

  // The replaced snapshot is gone, so the stale asset is only prunable later
  // because the manifest recorded it before publication overwrote the file.
  const snapshot = JSON.parse(result.outputs['data/enduser-landscape.json']);
  assert.ok(
    !snapshot.records.some((record) => record.displayName === 'Stale Co'),
  );
});

test('warns about an unmirrorable logo without dropping the organization', () => {
  const result = collect({
    repos: landscapeRepo({
      'landscape.yml': landscapeYaml({ acmeLogo: 'missing.svg' }),
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /\[warn\] .*Acme \(member\): landscape logo is a symlink or is missing: missing\.svg/,
  );

  const snapshot = JSON.parse(result.outputs['data/enduser-landscape.json']);
  const acme = snapshot.records.find((record) => record.displayName === 'Acme');
  assert.equal(acme.included, true);
  assert.equal(acme.localLogo, null);
  assert.match(acme.logoWarning, /landscape logo is a symlink or is missing/);
});

test('fails closed and leaves the previous snapshot intact when selection is invalid', () => {
  const previousRaw =
    JSON.stringify({ generated: true, records: [], marker: 'untouched' }) +
    '\n';
  const result = collect({
    repos: landscapeRepo({
      'landscape.yml': 'landscape:\n  - name: Other\n',
    }),
    fixtures: { 'data/enduser-landscape.json': previousRaw },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing landscape category: CNCF Members/);
  assert.equal(result.outputs['data/enduser-landscape.json'], previousRaw);
});

test('rejects a clone whose revision is not a full commit sha', () => {
  // Delegating the shim's non-clone invocations to `echo` leaves the fixture
  // checkout intact but makes `git rev-parse HEAD` answer with something that
  // is not a 40-hex sha, which is the only way the provenance guard can be
  // reached without an unpinnable snapshot escaping into data/.
  const result = collect({ env: { ENDUSERS_REAL_GIT: '/bin/echo' } });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /landscape clone returned an invalid revision: /);
  assert.equal(result.outputs['data/enduser-landscape.json'], null);
});
