// `collect()` is the part of tests/tools/coverage-report.mjs that every
// coverage gate in this repository ultimately rests on: it reads the raw
// NODE_V8_COVERAGE dump, folds each sandbox URL back onto the real source
// tree, and merges every process's record for a file into one per-offset
// count map. `--check`, `--check-regions`, `--check-source` and
// `--check-source-regions` all score whatever it hands back.
//
// It had no direct test. The reporter runs `collect()` in the *parent*
// process, and only the child `node --test` run carries NODE_V8_COVERAGE, so
// the function's own execution is never recorded: its merge loop, its
// skip-this-record fallbacks and its unmapped bookkeeping were all invisible
// to the very report they produce. A regression in any of them would not fail
// a test; it would silently move the published percentage.
//
// These tests drive `collect()` against a hand-built coverage directory, so
// the merge arithmetic and each fallback are pinned independently of whatever
// the real suite happens to execute.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { collect } from './tools/coverage-report.mjs';

// A coverage directory plus a matching fake repository root, so a record can
// name a file that really exists on disk (collect() reads the source to learn
// its length) without touching the real tree.
function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'endusers-collect-'));
  const coverageDir = join(base, 'coverage');
  const root = join(base, 'repo');
  mkdirSync(coverageDir);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return { base, coverageDir, root };
}

function writeSource(root, relPath, source) {
  writeFileSync(join(root, relPath), source);
  return pathToFileURL(join(root, relPath)).href;
}

function writeRecord(coverageDir, name, result) {
  writeFileSync(join(coverageDir, name), JSON.stringify({ result }));
}

// One V8 script record: an outermost range over the whole text (so
// recordedSourceLength matches the file), plus any inner ranges given.
function script(url, length, inner = []) {
  return {
    url,
    functions: [
      {
        ranges: [
          { startOffset: 0, endOffset: length, count: 1 },
          ...inner.map(([startOffset, endOffset, count]) => ({
            startOffset,
            endOffset,
            count,
          })),
        ],
      },
    ],
  };
}

function withSandbox(run) {
  const box = sandbox();
  try {
    return run(box);
  } finally {
    rmSync(box.base, { recursive: true, force: true });
  }
}

test('collect merges two records for one file by taking the highest count per offset', () => {
  withSandbox(({ coverageDir, root }) => {
    // 20 characters; each record leaves a different half unexecuted.
    const source = 'const a=1;const b=2;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    writeRecord(coverageDir, 'first.json', [
      script(url, source.length, [[10, 20, 0]]),
    ]);
    writeRecord(coverageDir, 'second.json', [
      script(url, source.length, [[0, 10, 0]]),
    ]);

    const { merged } = collect(coverageDir, root);
    const { counts } = merged.get('scripts/a.mjs');

    // Neither record alone covers the whole file; the merge does.
    for (let i = 0; i < source.length; i += 1) {
      assert.ok(counts[i] > 0, `offset ${i} should be covered after merging`);
    }
  });
});

test('collect keeps the higher count when both records executed the same offset', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    writeRecord(coverageDir, 'low.json', [
      script(url, source.length, [[0, source.length, 3]]),
    ]);
    writeRecord(coverageDir, 'high.json', [
      script(url, source.length, [[0, source.length, 9]]),
    ]);

    const { merged } = collect(coverageDir, root);
    assert.equal(merged.get('scripts/a.mjs').counts[0], 9);
  });
});

test('collect never lowers a count already recorded by an earlier record', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    // Deliberately ordered so the zero arrives second: a plain overwrite
    // would report this file as uncovered.
    writeRecord(coverageDir, 'a-hit.json', [
      script(url, source.length, [[0, source.length, 5]]),
    ]);
    writeRecord(coverageDir, 'b-miss.json', [
      script(url, source.length, [[0, source.length, 0]]),
    ]);

    const { merged } = collect(coverageDir, root);
    assert.equal(merged.get('scripts/a.mjs').counts[0], 5);
  });
});

test('collect folds a sandbox copy of a script onto the real source path', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    writeSource(root, 'scripts/a.mjs', source);
    // The URL a sandboxed run records: the same file, executed from a temp
    // directory that mirrors the repository layout.
    const sandboxUrl = pathToFileURL(
      join(tmpdir(), 'endusers-import-XXXX', 'scripts', 'a.mjs'),
    ).href;
    writeRecord(coverageDir, 'sandbox.json', [
      script(sandboxUrl, source.length, [[0, source.length, 4]]),
    ]);

    const { merged } = collect(coverageDir, root);
    assert.deepEqual([...merged.keys()], ['scripts/a.mjs']);
    assert.equal(merged.get('scripts/a.mjs').counts[0], 4);
  });
});

test('collect ignores directory entries that are not coverage JSON', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    const otherUrl = writeSource(root, 'scripts/b.mjs', source);
    writeRecord(coverageDir, 'real.json', [script(url, source.length)]);
    // Valid coverage JSON under a name the reporter must not read: only the
    // extension keeps scripts/b.mjs out of the report, so a broken filter
    // cannot hide behind the malformed-file fallback.
    writeRecord(coverageDir, 'real.json.tmp', [
      script(otherUrl, source.length),
    ]);
    writeRecord(coverageDir, 'coverage-backup', [
      script(otherUrl, source.length),
    ]);

    const { merged } = collect(coverageDir, root);
    assert.deepEqual([...merged.keys()], ['scripts/a.mjs']);
  });
});

test('collect skips an malformed coverage file instead of aborting the run', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    // A partially flushed dump from a process killed mid-write. The reporter
    // must still report the records it can read rather than throwing and
    // losing the whole run.
    writeFileSync(join(coverageDir, 'aborted.json'), '{"result":[{"url":');
    writeRecord(coverageDir, 'good.json', [script(url, source.length)]);

    const { merged } = collect(coverageDir, root);
    assert.deepEqual([...merged.keys()], ['scripts/a.mjs']);
  });
});

test('collect skips a record whose file is no longer on disk', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    // A sandbox copy that was cleaned up before the reporter ran: the path
    // folds onto scripts/deleted.mjs, which never existed in this root.
    const goneUrl = pathToFileURL(join(root, 'scripts', 'deleted.mjs')).href;
    writeRecord(coverageDir, 'gone.json', [script(goneUrl, 10)]);
    writeRecord(coverageDir, 'good.json', [script(url, source.length)]);

    const { merged, unmapped } = collect(coverageDir, root);
    assert.deepEqual([...merged.keys()], ['scripts/a.mjs']);
    // A missing file is not an offset-domain mismatch, so it is not reported
    // as unmapped either -- it is simply not there.
    assert.equal(unmapped.has('scripts/deleted.mjs'), false);
  });
});

test('collect ignores a record for a path outside the repository', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    writeRecord(coverageDir, 'external.json', [
      script('node:internal/modules/esm/loader', 100),
      script(pathToFileURL(join(tmpdir(), 'stray.mjs')).href, 10),
      script(url, source.length),
    ]);

    const { merged } = collect(coverageDir, root);
    assert.deepEqual([...merged.keys()], ['scripts/a.mjs']);
  });
});

test('collect reports a file as unmapped when the recorded text is not the file on disk', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    // A loader-generated wrapper is longer than the source, so its offsets
    // address text that does not exist on disk. The file has no `<`, so the
    // JSX remap is not attempted and the record is discarded outright.
    writeRecord(coverageDir, 'wrapped.json', [script(url, source.length + 40)]);

    const { merged, unmapped } = collect(coverageDir, root);
    assert.equal(merged.has('scripts/a.mjs'), false);
    assert.deepEqual([...unmapped], ['scripts/a.mjs']);
  });
});

test('collect stops reporting a file as unmapped once any record maps onto it', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;';
    const url = writeSource(root, 'scripts/a.mjs', source);
    // Same file, recorded twice: once against generated text, once against
    // the real source. One usable record is enough to attribute the file.
    writeRecord(coverageDir, 'a-wrapped.json', [
      script(url, source.length + 40),
    ]);
    writeRecord(coverageDir, 'b-direct.json', [
      script(url, source.length, [[0, source.length, 2]]),
    ]);

    const { merged, unmapped } = collect(coverageDir, root);
    assert.equal(merged.get('scripts/a.mjs').counts[0], 2);
    assert.equal(unmapped.size, 0);
  });
});

test('collect records the source text alongside the counts it measured', () => {
  withSandbox(({ coverageDir, root }) => {
    const source = 'const a=1;\nconst b=2;\n';
    const url = writeSource(root, 'scripts/a.mjs', source);
    writeRecord(coverageDir, 'only.json', [script(url, source.length)]);

    const { merged } = collect(coverageDir, root);
    const entry = merged.get('scripts/a.mjs');
    assert.equal(entry.source, source);
    assert.equal(entry.counts.length, source.length);
  });
});

test('collect returns an empty result for a coverage directory with nothing usable in it', () => {
  withSandbox(({ coverageDir, root }) => {
    writeFileSync(join(coverageDir, 'aborted.json'), 'not json');
    const { merged, unmapped } = collect(coverageDir, root);
    assert.equal(merged.size, 0);
    assert.equal(unmapped.size, 0);
  });
});
