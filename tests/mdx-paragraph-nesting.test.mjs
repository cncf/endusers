// Guards against JSX <p> elements in docs/ and blog/ whose content starts on a
// following line. MDX parses such children as markdown flow content and wraps
// them in a paragraph of its own, emitting <p><p>...</p></p> — invalid HTML
// that the HTML parser recovers from by splitting the paragraph and leaving a
// stray end tag. `docusaurus build` reports it only as a non-fatal minifier
// diagnostic, so the build stays green and nothing in the suite notices.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(join(repoRoot, dir), {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    if (!/\.mdx?$/.test(entry.name)) continue;
    found.push(relative(repoRoot, join(entry.parentPath, entry.name)));
  }
  return found;
}

const files = [...markdownFiles('docs'), ...markdownFiles('blog')].sort();

// A `<p ...>` open tag with nothing but whitespace after it on the same line.
const MULTILINE_P = /^[ \t]*<p(?:\s[^>\n]*)?>[ \t]*$/;

function offendingLines(source) {
  return source
    .split('\n')
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => MULTILINE_P.test(line))
    .map(([lineNumber]) => lineNumber);
}

test('the scan finds markdown sources to check', () => {
  assert.ok(
    files.length > 0,
    'no .md/.mdx files found under docs/ or blog/ — the assertions below would be vacuous',
  );
});

test('the detector matches a multi-line <p> and not a single-line one', () => {
  assert.deepEqual(offendingLines('<p>\n  text\n</p>\n'), [1]);
  assert.deepEqual(
    offendingLines('  <p className="x">\n  text\n  </p>\n'),
    [1],
  );
  assert.deepEqual(offendingLines('<p>text</p>\n'), []);
  assert.deepEqual(offendingLines('<p className="x">text</p>\n'), []);
});

test('no JSX <p> in docs/ or blog/ defers its content to the next line', () => {
  const offenders = [];
  for (const file of files) {
    for (const lineNumber of offendingLines(
      readFileSync(join(repoRoot, file), 'utf8'),
    )) {
      offenders.push(`${file}:${lineNumber}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `MDX wraps these <p> elements' content in a second paragraph, emitting invalid nested <p>. Put the content on the same line as the tag:\n${offenders.join('\n')}`,
  );
});
