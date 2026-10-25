import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'check-landscape-drift.mjs';
const SNAPSHOT = 'data/enduser-landscape.json';
const REVISION = 'bc9d1b5c87904d9430fc3377938f38192bab3ad0';

// A `git` shim placed first on PATH, the same device tests/landscape-source.
// test.mjs uses: `clone` materialises the fixture landscape.yml at the
// requested destination and `rev-parse` answers with a fixed revision, so the
// script runs its real upstream read against a document the test wrote.
const GIT_SHIM = `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  clone)
    dest="\${@: -1}"
    mkdir -p "$dest"
    printf '%s' "$LANDSCAPE_DRIFT_YAML" > "$dest/landscape.yml"
    ;;
  -C)
    printf '%s\\n' "$LANDSCAPE_DRIFT_REVISION"
    ;;
esac
`;

/**
 * The landscape.yml the shimmed clone produces for a set of member names.
 *
 * Every entry is a selected end user member: `enduser: true` with the
 * `(member)` suffix classifyLandscapeDocument requires.
 *
 * @param {Array<{name: string, homepage: string}>} members
 * @returns {string} landscape.yml source
 */
function landscapeYaml(members) {
  const items = members
    .map(
      ({ name, homepage }) =>
        `          - name: ${name} (member)\n` +
        `            homepage_url: ${homepage}\n` +
        '            logo: logo.svg\n' +
        '            enduser: true\n' +
        '            extra:\n' +
        '              annual_review_date: 2026-01-01\n',
    )
    .join('');
  // classifyLandscapeDocument requires the supporter subcategory to be
  // present, so that an upstream rename is reported rather than silently
  // dropping every contributor from the selection.
  return (
    'landscape:\n' +
    '  - name: CNCF Members\n' +
    '    subcategories:\n' +
    '      - name: Platinum\n' +
    '        items:\n' +
    items +
    '      - name: End User Supporter and Contributor\n' +
    '        items: []\n'
  );
}

/**
 * The committed snapshot fixture for a set of member names.
 *
 * @param {Array<{name: string, homepage: string}>} members
 * @returns {string} data/enduser-landscape.json source
 */
function snapshotJson(members) {
  return JSON.stringify({
    collectedAt: '2026-10-01T05:13:13.673Z',
    source: { revision: REVISION },
    records: members.map(({ name, homepage }) => ({
      sourceId: `cncf/landscape#CNCF Members/Platinum/${name} (member)`,
      sourceRole: 'member',
      included: true,
      sourceName: `${name} (member)`,
      displayName: name,
      category: 'CNCF Members',
      subcategory: 'Platinum',
      enduser: true,
      homepageUrl: homepage,
    })),
  });
}

/**
 * Runs the check with a shimmed `git` that clones `upstream`.
 *
 * @param {object} options
 * @param {Array<{name: string, homepage: string}>} options.upstream
 * @param {string} options.snapshot data/enduser-landscape.json contents
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run({ upstream, snapshot }) {
  const shimRoot = mkdtempSync(join(tmpdir(), 'endusers-drift-shim-'));
  const binDir = join(shimRoot, 'bin');
  const saved = Object.fromEntries(
    ['PATH', 'LANDSCAPE_DRIFT_YAML', 'LANDSCAPE_DRIFT_REVISION'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  mkdirSync(binDir);
  writeFileSync(join(binDir, 'git'), GIT_SHIM, { mode: 0o755 });
  process.env.PATH = `${binDir}${delimiter}${saved.PATH}`;
  process.env.LANDSCAPE_DRIFT_YAML = landscapeYaml(upstream);
  process.env.LANDSCAPE_DRIFT_REVISION = REVISION;
  try {
    return runScriptWithFixtures(SCRIPT, { [SNAPSHOT]: snapshot });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(shimRoot, { recursive: true, force: true });
  }
}

const ADYEN = { name: 'Adyen', homepage: 'https://www.adyen.com' };
const SPOTIFY = { name: 'Spotify', homepage: 'https://www.spotify.com' };

test('passes and names the revision when the snapshot matches upstream', () => {
  const members = [ADYEN, SPOTIFY];
  const result = run({
    upstream: members,
    snapshot: snapshotJson(members),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /still matches cncf\/landscape/);
  assert.match(result.stdout, new RegExp(REVISION));
});

// The failure this check exists for: upstream lists an organisation the
// committed snapshot predates, so /community/members/ renders one member short
// until the on-demand refresh runs.
test('fails and names an organisation the directory is missing', () => {
  const result = run({
    upstream: [ADYEN, SPOTIFY],
    snapshot: snapshotJson([ADYEN]),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing from the directory: Spotify \(member\)/);
  assert.match(result.stderr, /no longer matches cncf\/landscape/);
});

// The instruction has to be in the output: a check that reports drift without
// saying what clears it sends the reader to the source to find out.
test('names the refresh that clears the drift', () => {
  const result = run({
    upstream: [ADYEN, SPOTIFY],
    snapshot: snapshotJson([ADYEN]),
  });

  assert.match(result.stderr, /Refresh metrics/);
  assert.match(result.stderr, /npm run collect:enduser-members/);
  assert.match(result.stderr, /npm run generate:members/);
});

test('fails when upstream dropped an organisation the directory still shows', () => {
  const result = run({
    upstream: [ADYEN],
    snapshot: snapshotJson([ADYEN, SPOTIFY]),
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /no longer selected upstream: Spotify \(member\)/,
  );
});

test('fails when an organisation moved its homepage upstream', () => {
  const result = run({
    upstream: [{ ...ADYEN, homepage: 'https://adyen.com' }],
    snapshot: snapshotJson([ADYEN]),
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /changed upstream: Adyen — homepageUrl: https:\/\/www\.adyen\.com -> https:\/\/adyen\.com/,
  );
});
