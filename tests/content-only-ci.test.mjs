import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  baseShaForEvent,
  classifyChanges,
  classifyCurrentEvent,
  decodeChangedDocuments,
  isAuthoredDocumentPath,
  parseNameStatus,
  runDocumentLint,
  runClassifier,
  writeOutputs,
} from '../scripts/lib/content-only-ci.mjs';

const BASE_SHA = 'a'.repeat(40);

test('accepts authored documents in supported content locations', () => {
  for (const path of [
    'README.md',
    'CODE_OF_CONDUCT.md',
    'CONTENT-SECURITY.md',
    'CONTRIBUTING.md',
    'GOVERNANCE.md',
    'MAINTAINERS.md',
    'SECURITY.md',
    'adr/0011-content-focused-validation-for-documentation.md',
    'blog/2026-10-29-post.md',
    'docs/community/user-groups/research/index.md',
    'docs/architectures/index.md',
    'docs/architectures/submit.md',
  ]) {
    assert.equal(isAuthoredDocumentPath(path), true, path);
  }
});

test('rejects generated and data-backed documents', () => {
  for (const path of [
    'docs/architectures/zeiss/index.md',
    'docs/community/awards.md',
    'docs/community/members.md',
    'docs/community/projects-born.md',
    'docs/events/index.md',
    'docs/resources/case-studies.md',
    'docs/resources/changelog.md',
    'docs/resources/metrics.md',
    'docs/resources/radar-reports.md',
  ]) {
    assert.equal(isAuthoredDocumentPath(path), false, path);
  }
});

test('rejects code, data, config, assets, and internal agent instructions', () => {
  for (const path of [
    '.agents/skills/doc-authoring/SKILL.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'AGENTS.md',
    'data/awards.json',
    'docs/community/index.js',
    'docs/community/logo.svg',
    'docs/example.md.backup',
    'docs/example.mdx.backup',
    'scripts/validate-community-groups.mjs',
    'tests/content-only-ci.test.mjs',
  ]) {
    assert.equal(isAuthoredDocumentPath(path), false, path);
  }
});

test('rejects unsafe and malformed document paths', () => {
  for (const path of [
    '',
    '/docs/example.md',
    'docs/../README.md',
    'docs/./example.md',
    'docs\\community\\index.md',
    null,
  ]) {
    assert.equal(isAuthoredDocumentPath(path), false);
  }
});

test('parses NUL-delimited git name-status output without losing spaces', () => {
  assert.deepEqual(
    parseNameStatus('M\0docs/a file.md\0A\0docs/new.md\0D\0docs/old.md\0'),
    [
      { status: 'M', path: 'docs/a file.md' },
      { status: 'A', path: 'docs/new.md' },
      { status: 'D', path: 'docs/old.md' },
    ],
  );
});

test('parses empty git diff output as no changes', () => {
  assert.deepEqual(parseNameStatus(''), []);
  assert.deepEqual(parseNameStatus('M\0docs/file.md'), [
    { status: 'M', path: 'docs/file.md' },
  ]);
  assert.equal(parseNameStatus('M\0\0'), null);
});

test('treats malformed git diff output as unclassifiable', () => {
  for (const output of [
    null,
    'M\0',
    'M\0docs/file.md\0R100\0old.md\0',
    'MA\0docs/file.md\0',
    'Mfoo\0docs/file.md\0',
  ]) {
    assert.equal(parseNameStatus(output), null);
  }
});

test('classifies a docs-only change and excludes deleted files from lint input', () => {
  const result = classifyChanges('pull_request', BASE_SHA, [
    { status: 'M', path: 'docs/community/user-groups/research/index.md' },
    { status: 'A', path: 'docs/community/index.md' },
    { status: 'D', path: 'docs/community/user-groups/research/old.md' },
  ]);

  assert.equal(result.documentOnly, true);
  assert.deepEqual(result.documents, [
    'docs/community/user-groups/research/index.md',
    'docs/community/index.md',
  ]);
});

test('accepts merge-group content diffs', () => {
  const result = classifyChanges('merge_group', BASE_SHA, [
    { status: 'M', path: 'docs/community/index.md' },
  ]);

  assert.equal(result.documentOnly, true);
});

test('uses full validation for empty, unknown, mixed, or uncertain changes', () => {
  const cases = [
    ['pull_request', BASE_SHA, []],
    [
      'workflow_dispatch',
      BASE_SHA,
      [{ status: 'M', path: 'docs/community/index.md' }],
    ],
    [
      'pull_request',
      `${BASE_SHA}x`,
      [{ status: 'M', path: 'docs/community/index.md' }],
    ],
    [
      'pull_request',
      `x${BASE_SHA}`,
      [{ status: 'M', path: 'docs/community/index.md' }],
    ],
    [
      'pull_request',
      BASE_SHA.slice(1),
      [{ status: 'M', path: 'docs/community/index.md' }],
    ],
    ['pull_request', BASE_SHA, null],
    ['pull_request', BASE_SHA, [null]],
    [
      'pull_request',
      BASE_SHA,
      [
        { status: 'M', path: 'docs/example.md' },
        { status: 'M', path: 'src/component.js' },
      ],
    ],
    ['pull_request', BASE_SHA, [{ status: 'R100', path: 'docs/new.md' }]],
    ['pull_request', BASE_SHA, [{ status: 'M', path: 'unknown/file.md' }]],
  ];

  for (const [event, base, changes] of cases) {
    assert.deepEqual(classifyChanges(event, base, changes), {
      documentOnly: false,
      documents: [],
    });
  }
});

test('does not pass through a generated or data-backed document change', () => {
  for (const path of [
    'docs/resources/case-studies.md',
    'docs/architectures/zeiss/index.md',
  ]) {
    assert.deepEqual(
      classifyChanges('pull_request', BASE_SHA, [{ status: 'M', path }]),
      { documentOnly: false, documents: [] },
    );
  }
});

test('uses full validation for document paths that are not regular files', () => {
  const path = 'docs/__content-only-ci-test__.md';
  symlinkSync('../README.md', path);
  try {
    assert.deepEqual(
      classifyChanges('pull_request', BASE_SHA, [{ status: 'A', path }]),
      { documentOnly: false, documents: [] },
    );
  } finally {
    rmSync(path, { force: true });
  }
});

test('uses supported event-specific base SHAs', () => {
  const environment = { PR_BASE_SHA: 'pr', MERGE_BASE_SHA: 'merge' };
  assert.equal(baseShaForEvent('pull_request', environment), 'pr');
  assert.equal(baseShaForEvent('merge_group', environment), 'merge');
  assert.equal(baseShaForEvent('workflow_dispatch', environment), null);
});

test('classifies invalid or unsupported events as full validation', () => {
  const environments = [
    { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: 'bad' },
    { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: `${BASE_SHA}x` },
    { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: `x${BASE_SHA}` },
    { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: BASE_SHA.slice(1) },
    { GITHUB_EVENT_NAME: 'workflow_dispatch', PR_BASE_SHA: BASE_SHA },
  ];
  for (const environment of environments) {
    let readDiffCalled = false;
    const readDiff = () => {
      readDiffCalled = true;
      return 'M\0docs/community/index.md\0';
    };
    assert.deepEqual(classifyCurrentEvent(environment, readDiff), {
      documentOnly: false,
      documents: [],
    });
    assert.equal(readDiffCalled, false);
  }
});

test('reads the event diff and fails closed when git cannot read it', () => {
  let gitCall;
  assert.deepEqual(
    classifyCurrentEvent(
      { GITHUB_EVENT_NAME: 'pull_request', PR_BASE_SHA: BASE_SHA },
      (...args) => {
        gitCall = args;
        return 'M\0docs/community/index.md\0';
      },
    ),
    { documentOnly: true, documents: ['docs/community/index.md'] },
  );
  assert.deepEqual(gitCall, [
    'git',
    ['diff', '--name-status', '-z', '--no-renames', BASE_SHA, 'HEAD', '--'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    },
  ]);

  const warnings = [];
  assert.deepEqual(
    classifyCurrentEvent(
      { GITHUB_EVENT_NAME: 'merge_group', MERGE_BASE_SHA: BASE_SHA },
      () => {
        throw new Error('git unavailable');
      },
      (warning) => warnings.push(warning),
    ),
    { documentOnly: false, documents: [] },
  );
  assert.deepEqual(warnings, [
    'Could not classify changed paths; using full validation: git unavailable',
  ]);
});

test('writes safely encoded GitHub Actions outputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'content-only-ci-'));
  const outputPath = join(directory, 'output');
  try {
    appendFileSync(outputPath, 'existing=value\n');
    const result = {
      documentOnly: true,
      documents: ['docs/community/user groups/research.md'],
    };
    writeOutputs(result, outputPath);
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      `existing=value\ndocument_only=true\ndocuments_b64=${Buffer.from(
        JSON.stringify(result.documents),
      ).toString('base64')}\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('requires a GitHub Actions output file', () => {
  assert.throws(
    () => writeOutputs({ documentOnly: false, documents: [] }, ''),
    {
      message: 'GITHUB_OUTPUT is required',
    },
  );
});

test('runs the classifier and writes full-validation outputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'content-only-ci-'));
  const outputPath = join(directory, 'output');
  const logs = [];
  try {
    const result = runClassifier(
      {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_OUTPUT: outputPath,
      },
      undefined,
      (message) => logs.push(message),
    );
    assert.deepEqual(result, { documentOnly: false, documents: [] });
    assert.match(readFileSync(outputPath, 'utf8'), /^document_only=false\n/);
    assert.deepEqual(logs, ['Using full validation']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reports the document-only classifier result', () => {
  const directory = mkdtempSync(join(tmpdir(), 'content-only-ci-'));
  const outputPath = join(directory, 'output');
  const logs = [];
  try {
    const result = runClassifier(
      { GITHUB_OUTPUT: outputPath },
      () => ({
        documentOnly: true,
        documents: ['README.md'],
      }),
      (message) => logs.push(message),
    );
    assert.deepEqual(result, { documentOnly: true, documents: ['README.md'] });
    assert.match(readFileSync(outputPath, 'utf8'), /^document_only=true\n/);
    assert.deepEqual(logs, ['Document-only change: 1 changed document(s)']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('decodes and validates the changed-document list', () => {
  const encoded = (documents) =>
    Buffer.from(JSON.stringify(documents)).toString('base64');
  assert.deepEqual(
    decodeChangedDocuments(encoded(['README.md', 'README.md'])),
    ['README.md'],
  );
  assert.deepEqual(decodeChangedDocuments(encoded([])), []);
  assert.deepEqual(runDocumentLint(encoded([])), {
    documents: [],
    checked: [],
  });

  for (const invalid of [undefined, '', '!', '!W10=', 'W10=!']) {
    assert.throws(() => decodeChangedDocuments(invalid), {
      message: 'CHANGED_DOCUMENTS_B64 must be a non-empty base64 string',
    });
  }
  assert.throws(
    () => decodeChangedDocuments(Buffer.from('not json').toString('base64')),
    (error) =>
      error.message ===
        'CHANGED_DOCUMENTS_B64 must encode a JSON document list' &&
      error.cause instanceof SyntaxError,
  );
  assert.throws(
    () => decodeChangedDocuments(Buffer.from('"README.md"').toString('base64')),
    {
      message: 'CHANGED_DOCUMENTS_B64 must encode a JSON document list',
    },
  );
  assert.throws(() => decodeChangedDocuments(encoded(['src/app.js'])), {
    message: 'Not an authored document path: src/app.js',
  });
  assert.throws(
    () => decodeChangedDocuments(encoded(['docs/not-a-real-page.md'])),
    { message: 'Changed document does not exist: docs/not-a-real-page.md' },
  );
});

test('runs changed-document formatting, spelling, and Markdown checks', () => {
  const calls = [];
  const result = runDocumentLint(
    Buffer.from(JSON.stringify(['README.md'])).toString('base64'),
    (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  );

  assert.deepEqual(result, {
    documents: ['README.md'],
    checked: ['prettier', 'cspell', '--no-install'],
  });
  const options = {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
  };
  assert.deepEqual(calls, [
    {
      command: 'npx',
      args: ['prettier', '--check', 'README.md'],
      options,
    },
    {
      command: 'npx',
      args: ['cspell', '--no-progress', '-c', '.cspell.yml', 'README.md'],
      options,
    },
    {
      command: 'npx',
      args: [
        '--no-install',
        'markdownlint',
        '-c',
        '.markdownlint.yaml',
        'README.md',
      ],
      options,
    },
  ]);
});

test('preserves repository Prettier ignores for blog documents', () => {
  const calls = [];
  runDocumentLint(
    Buffer.from(
      JSON.stringify(['blog/2026-07-22-welcome-to-endusers-cncf-io.md']),
    ).toString('base64'),
    (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  );

  assert.deepEqual(calls[0], {
    command: 'npx',
    args: [
      'prettier',
      '--check',
      'blog/2026-07-22-welcome-to-endusers-cncf-io.md',
    ],
  });
});

test('runs only formatting and spelling for MDX documents', () => {
  const path = 'docs/__content-only-ci-test__.mdx';
  writeFileSync(path, '# Test\n');
  try {
    const calls = [];
    const result = runDocumentLint(
      Buffer.from(JSON.stringify([path])).toString('base64'),
      (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    );
    assert.deepEqual(result.checked, ['prettier', 'cspell']);
    assert.deepEqual(
      calls.map(({ args }) => args[0]),
      ['prettier', 'cspell'],
    );
  } finally {
    rmSync(path, { force: true });
  }
});

test('fails changed-document lint when a command fails or cannot start', () => {
  const encoded = Buffer.from(JSON.stringify(['README.md'])).toString('base64');
  assert.throws(
    () => runDocumentLint(encoded, () => ({ status: 1 })),
    /npx prettier failed with status 1/u,
  );
  const failure = new Error('command unavailable');
  assert.throws(
    () => runDocumentLint(encoded, () => ({ error: failure })),
    (error) => error === failure,
  );
});
