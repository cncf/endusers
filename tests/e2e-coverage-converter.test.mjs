import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import v8ToIstanbul from 'v8-to-istanbul';

async function loadConverter(source) {
  const dir = await mkdtemp(join(tmpdir(), 'endusers-e2e-v8-'));
  const file = join(dir, 'fixture.mjs');
  await writeFile(file, source);
  return {
    dir,
    file,
    converter: v8ToIstanbul(pathToFileURL(file).href, 0, { source }),
  };
}

test('v8-to-istanbul applies a native zero-count child range', async () => {
  const source = 'const hit = 1;\nconst miss = 2;\n';
  const { dir, file, converter } = await loadConverter(source);
  try {
    await converter.load();
    const missStart = source.indexOf('const miss');
    converter.applyCoverage([
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [
          { startOffset: 0, endOffset: source.length, count: 1 },
          {
            startOffset: missStart,
            endOffset: source.length,
            count: 0,
          },
        ],
      },
    ]);

    const result = converter.toIstanbul()[file];
    assert.equal(result.s[0], 1);
    assert.equal(result.s[1], 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('v8-to-istanbul applies nested ranges in input order', async () => {
  const source = 'const hit = 1;\nconst miss = 2;\n';
  const { dir, file, converter } = await loadConverter(source);
  try {
    await converter.load();
    const missStart = source.indexOf('const miss');
    converter.applyCoverage([
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [
          {
            startOffset: missStart,
            endOffset: source.length,
            count: 0,
          },
          { startOffset: 0, endOffset: source.length, count: 1 },
        ],
      },
    ]);

    const result = converter.toIstanbul()[file];
    assert.equal(result.s[0], 1);
    // The mature converter handles V8's native outer-before-inner ordering,
    // but it does not repair reversed input. The report normalizes raw ranges
    // before calling it.
    assert.equal(result.s[1], 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('v8-to-istanbul accepts UTF-16 offsets around astral characters', async () => {
  const source = 'const label = "cloud ☁";\nconst hit = 1;\n';
  const { dir, file, converter } = await loadConverter(source);
  try {
    await converter.load();
    const hitStart = source.indexOf('const hit');
    converter.applyCoverage([
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [{ startOffset: hitStart, endOffset: source.length, count: 1 }],
      },
    ]);

    const result = converter.toIstanbul()[file];
    assert.equal(result.s[1], 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
