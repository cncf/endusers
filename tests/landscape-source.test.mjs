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
import { delimiter, join } from 'node:path';
import { readLandscape } from '../scripts/lib/landscape-source.mjs';

const REVISION = 'bc9d1b5c87904d9430fc3377938f38192bab3ad0';
const LANDSCAPE_YAML = 'landscape:\n  - name: CNCF Members\n    city: Zürich\n';
const SHIM_ENV = [
  'LANDSCAPE_SOURCE_GIT_LOG',
  'LANDSCAPE_SOURCE_YAML',
  'LANDSCAPE_SOURCE_REVISION',
];

// A `git` shim placed first on PATH. `clone` materialises the fixture
// landscape.yml at the requested destination and `rev-parse` answers with the
// revision under test, so the shape of commit sha the reader accepts can be
// driven from the test. Every invocation is appended to the log, one line per
// call with the arguments separated by tabs, so the test can assert on what
// readLandscape asked git to do rather than only on what it returned.
const GIT_SHIM = `#!/usr/bin/env bash
set -euo pipefail
line=""
for arg in "$@"; do line="$line$arg"$'\\t'; done
printf '%s\\n' "$line" >> "$LANDSCAPE_SOURCE_GIT_LOG"
case "\${1:-}" in
  clone)
    dest="\${@: -1}"
    mkdir -p "$dest"
    printf '%s' "$LANDSCAPE_SOURCE_YAML" > "$dest/landscape.yml"
    ;;
  -C)
    printf '%s\\n' "$LANDSCAPE_SOURCE_REVISION"
    ;;
esac
`;

function withGitShim(revision, run) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-landscape-source-'));
  const binDir = join(root, 'bin');
  const log = join(root, 'git.log');
  const saved = Object.fromEntries(
    ['PATH', ...SHIM_ENV].map((key) => [key, process.env[key]]),
  );
  mkdirSync(binDir);
  writeFileSync(join(binDir, 'git'), GIT_SHIM, { mode: 0o755 });
  writeFileSync(log, '');
  process.env.PATH = `${binDir}${delimiter}${saved.PATH ?? ''}`;
  process.env.LANDSCAPE_SOURCE_GIT_LOG = log;
  process.env.LANDSCAPE_SOURCE_YAML = LANDSCAPE_YAML;
  process.env.LANDSCAPE_SOURCE_REVISION = revision;
  try {
    run({
      destination: join(root, 'landscape'),
      gitCalls: () =>
        readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('\t').slice(0, -1)),
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test('shallow-clones cncf/landscape, pins HEAD and parses landscape.yml as UTF-8', () => {
  withGitShim(REVISION, ({ destination, gitCalls }) => {
    const result = readLandscape(destination);
    assert.deepEqual(result, {
      revision: REVISION,
      document: { landscape: [{ name: 'CNCF Members', city: 'Zürich' }] },
    });
    assert.deepEqual(gitCalls(), [
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/cncf/landscape.git',
        destination,
      ],
      ['-C', destination, 'rev-parse', 'HEAD'],
    ]);
  });
});

// The pinned revision becomes the provenance of every generated record, so
// anything other than a full 40-character lowercase hex sha is rejected before
// landscape.yml is read. Each shape below passes a looser pattern: a short
// sha, one hex character too many, a non-hex prefix or suffix and a branch
// name.
test('rejects a clone whose HEAD is not a full lowercase hex sha', () => {
  const invalid = [
    REVISION.slice(0, 39),
    `${REVISION}a`,
    `z${REVISION.slice(1)}`,
    `${REVISION.slice(0, 39)}G`,
    'main',
  ];
  for (const revision of invalid) {
    withGitShim(revision, ({ destination, gitCalls }) => {
      assert.throws(
        () => readLandscape(destination),
        new Error(`landscape clone returned an invalid revision: ${revision}`),
      );
      assert.equal(gitCalls().length, 2);
    });
  }
});
