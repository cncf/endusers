// Builders for an e2e coverage run whose generated bundle is byte-for-byte its
// original source, so a source map over it is the identity and a region keeps
// the columns the test placed it at. tests/e2e-coverage-accepted-regions.test.mjs
// drives the reporter through these; the older reporter tests carry their own
// single-line copies of the same shape.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { initCoverageRun, writeCoverageArtifact } from './e2e-coverage-run.mjs';

const VLQ_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function vlq(value) {
  let encoded = value < 0 ? (-value << 1) | 1 : value << 1;
  let output = '';
  do {
    let digit = encoded & 31;
    encoded >>>= 5;
    if (encoded > 0) digit |= 32;
    output += VLQ_CHARS[digit];
  } while (encoded > 0);
  return output;
}

// Segments are emitted at column 0 of every line and at both ends of each
// token, so the tokens' regions map onto their own columns rather than
// folding onto the start of the line.
function identityMappings(source, tokens) {
  let previousSourceLine = 0;
  let previousSourceColumn = 0;
  return source
    .split('\n')
    .map((text, lineIndex) => {
      const columns = new Set([0]);
      for (const token of tokens) {
        const start = text.indexOf(token);
        if (start === -1) continue;
        columns.add(start);
        columns.add(start + token.length);
      }
      let previousGenerated = 0;
      return [...columns]
        .sort((a, b) => a - b)
        .map((column) => {
          const segment = [
            vlq(column - previousGenerated),
            vlq(0),
            vlq(lineIndex - previousSourceLine),
            vlq(column - previousSourceColumn),
          ].join('');
          previousGenerated = column;
          previousSourceLine = lineIndex;
          previousSourceColumn = column;
          return segment;
        })
        .join(',');
    })
    .join(';');
}

/**
 * Lays out one source file, its identity-mapped bundle and one captured
 * artifact in which every `missed` token is a zero-count range inside an
 * otherwise executed script. The run is left unsealed so the caller can add
 * to it.
 */
export async function writeIdentityMappedRun(
  root,
  { runId, file, source, missed },
) {
  const runDir = join(root, 'coverage');
  const buildDir = join(root, 'build');
  await mkdir(join(buildDir, 'assets/js'), { recursive: true });
  await mkdir(join(root, file, '..'), { recursive: true });
  await initCoverageRun(runDir, runId, { project: 'chromium' });

  const scriptText = `${source}\n//# sourceMappingURL=app.js.map\n`;
  await writeFile(join(root, file), source);
  await writeFile(join(buildDir, 'assets/js/app.js'), scriptText);
  await writeFile(
    join(buildDir, 'assets/js/app.js.map'),
    JSON.stringify({
      version: 3,
      file: 'app.js',
      sources: [`webpack://endusers/./${file}`],
      sourcesContent: [source],
      names: [],
      mappings: identityMappings(source, missed),
    }),
  );
  await writeCoverageArtifact(runDir, 'worker-0-page-0', {
    schemaVersion: 1,
    kind: 'endusers.playwright.v8-coverage',
    runId,
    result: [
      {
        url: 'http://localhost:3000/assets/js/app.js',
        scriptId: '1',
        functions: [
          {
            functionName: '',
            isBlockCoverage: true,
            ranges: [
              { startOffset: 0, endOffset: scriptText.length, count: 1 },
              ...missed.map((token) => ({
                startOffset: source.indexOf(token),
                endOffset: source.indexOf(token) + token.length,
                count: 0,
              })),
            ],
          },
        ],
      },
    ],
  });
  return { root, runDir, buildDir };
}

export function reportArgs(fixture, extra = []) {
  return [
    '--input',
    fixture.runDir,
    '--root',
    fixture.root,
    '--build',
    fixture.buildDir,
    '--json',
    join(fixture.root, 'report.json'),
    '--text',
    join(fixture.root, 'report.txt'),
    ...extra,
  ];
}
