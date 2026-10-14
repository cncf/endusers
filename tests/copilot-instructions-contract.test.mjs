// Guards .github/copilot-instructions.md, which no other test reads.
//
// The markdown gates (`npm run check:markdown`, `check:links`,
// `check:spelling`) now read .github/*.md too, but they check style, link
// liveness and spelling -- not whether the names the document cites still
// exist. Its two siblings under .github/ carry guards of the same kind:
// .github/dependabot.yml in tests/dependabot-contract.test.mjs, and the issue
// forms plus .github/PULL_REQUEST_TEMPLATE.md in
// tests/issue-template-contract.test.mjs.
//
// The file is worth guarding because it is not prose about intent: it names
// package.json scripts, committed datasets, and a collector script by path,
// and its reader is an agent that acts on a stale name rather than noticing
// it. Renaming a dataset is routine here, so these references drift.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const INSTRUCTIONS = '.github/copilot-instructions.md';

const instructions = readFileSync(join(repoRoot, INSTRUCTIONS), 'utf8');
const packageScripts = Object.keys(
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts,
);

// The inline-code spans of a markdown document. Fenced blocks are stripped
// first so an illustrative example inside one is not read as a claim about
// this repository.
function inlineCodeSpans(text) {
  const withoutFences = text.replace(/```[\s\S]*?```/g, '');
  const spans = [];
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    spans.push(match[1]);
  }
  return spans;
}

// `npm run <script>` as the document writes it, allowing the `-s`/`--silent`
// forms package.json itself uses.
function npmRunScripts(text) {
  const names = [];
  const pattern = /npm run (?:-s |--silent |--loglevel=\w+ )*([\w:.*-]+)/g;
  for (const match of text.matchAll(pattern)) names.push(match[1]);
  return names;
}

// A backticked token is treated as a repository path when it carries one of
// the source/data extensions this repository commits. Route names such as
// `/metrics` and command words such as `npm` are not paths and are skipped by
// construction: the leading character must not be a slash, and an extension is
// required.
const PATH_LIKE = /^[\w][\w./-]*\.(?:json|mjs|cjs|jsx?|md|ya?ml)$/;

function repositoryPaths(text) {
  const paths = [];
  for (const span of inlineCodeSpans(text)) {
    for (const token of span.split(/\s+/)) {
      if (PATH_LIKE.test(token) && !paths.includes(token)) paths.push(token);
    }
  }
  return paths;
}

// Bare and markdown-linked http(s) URLs alike: the document lists its
// authoritative sources as bare URLs under "Facts and sources".
function outboundUrls(text) {
  const urls = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    urls.push(match[0].replace(/[.,]$/, ''));
  }
  return urls;
}

test('the Copilot instructions are present and non-empty', () => {
  assert.notEqual(instructions.trim(), '', `${INSTRUCTIONS} must not be empty`);
});

test('every npm script the Copilot instructions name exists', () => {
  const missing = npmRunScripts(instructions).filter(
    (name) => !packageScripts.includes(name),
  );
  assert.deepEqual(
    missing,
    [],
    `${INSTRUCTIONS} names npm scripts that package.json does not define: ${missing.join(', ')}`,
  );
});

test('every repository path the Copilot instructions name exists', () => {
  const missing = repositoryPaths(instructions).filter(
    (path) => !existsSync(join(repoRoot, path)),
  );
  assert.deepEqual(
    missing,
    [],
    `${INSTRUCTIONS} names paths that are not on disk: ${missing.join(', ')}`,
  );
});

// Form, not liveness. Resolving these over the network is why `check:links`
// runs on a schedule (.github/workflows/check-links.yml) rather than in the
// per-PR gates: a third-party outage must not fail an unrelated pull request.
test('every source the Copilot instructions cite is fetched over https', () => {
  const insecure = outboundUrls(instructions).filter(
    (url) => !url.startsWith('https://'),
  );
  assert.deepEqual(
    insecure,
    [],
    `${INSTRUCTIONS} cites sources over plain http: ${insecure.join(', ')}`,
  );
});

// Without this the three guards above would keep passing if the document lost
// the references altogether, or if its syntax drifted past the extractors.
test('the Copilot instructions still carry what the guards above check', () => {
  assert.ok(
    npmRunScripts(instructions).length > 0,
    `${INSTRUCTIONS}: no "npm run" command found; the script guard is asserting nothing`,
  );
  assert.ok(
    repositoryPaths(instructions).length > 0,
    `${INSTRUCTIONS}: no repository path found; the path guard is asserting nothing`,
  );
  assert.ok(
    outboundUrls(instructions).length > 0,
    `${INSTRUCTIONS}: no outbound URL found; the https guard is asserting nothing`,
  );
});

test('inlineCodeSpans reads inline code and ignores fenced blocks', () => {
  assert.deepEqual(inlineCodeSpans('run `npm ci` first'), ['npm ci']);
  assert.deepEqual(inlineCodeSpans('```\n`npm run nope`\n```'), []);
  assert.deepEqual(inlineCodeSpans('`a` and `b`'), ['a', 'b']);
  assert.deepEqual(inlineCodeSpans('no code here'), []);
});

test('npmRunScripts reads script names apart from npm flags', () => {
  assert.deepEqual(npmRunScripts('`npm run build`'), ['build']);
  assert.deepEqual(npmRunScripts('npm run collect:metrics'), [
    'collect:metrics',
  ]);
  assert.deepEqual(npmRunScripts('npm run -s _list:check:md'), [
    '_list:check:md',
  ]);
  assert.deepEqual(npmRunScripts('npm run --silent fix'), ['fix']);
  assert.deepEqual(npmRunScripts('npm run --loglevel=warn fix'), ['fix']);
  assert.deepEqual(npmRunScripts('npm ci'), []);
});

test('repositoryPaths reads committed paths and skips routes and commands', () => {
  assert.deepEqual(repositoryPaths('`data/metrics.json`'), [
    'data/metrics.json',
  ]);
  assert.deepEqual(repositoryPaths('`scripts/collect-metrics.mjs`'), [
    'scripts/collect-metrics.mjs',
  ]);
  assert.deepEqual(repositoryPaths('`package-lock.json`'), [
    'package-lock.json',
  ]);
  assert.deepEqual(repositoryPaths('`/metrics` is a route'), []);
  assert.deepEqual(repositoryPaths('`npm install <package>`'), []);
  assert.deepEqual(repositoryPaths('`a/b.json` then `a/b.json`'), ['a/b.json']);
});

test('outboundUrls reads bare and linked URLs and trims trailing punctuation', () => {
  assert.deepEqual(outboundUrls('see https://example.com/x'), [
    'https://example.com/x',
  ]);
  assert.deepEqual(outboundUrls('[a](https://example.com/x)'), [
    'https://example.com/x',
  ]);
  assert.deepEqual(outboundUrls('at https://example.com/x.'), [
    'https://example.com/x',
  ]);
  assert.deepEqual(outboundUrls('at http://example.com/x'), [
    'http://example.com/x',
  ]);
  assert.deepEqual(outboundUrls('no links here'), []);
});
