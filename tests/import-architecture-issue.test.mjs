import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runImportArchitectureIssue } from './helpers-import-issue-sandbox.mjs';

// Every label the issue template renders, in template order. Mirrors
// scripts/import-architecture-issue.mjs's BODY_SECTIONS/field lookups: the
// script depends on these exact strings appearing as `### <label>` headings.
const LABELS = [
  'Organization or Team Name',
  'Organization Website',
  'Contact',
  'Contact Email',
  'Organization Size',
  'Target User Base Size',
  'Industries',
  'Tags',
  'Relevant CNCF Projects',
  'Describe your organisation',
  'Describe your entity and/or team',
  'Brief overview of your architecture and any potential goals you are trying to achieve with it?',
  'Can you expand on why you are using those projects/services?',
  'What has worked well?',
  'What has not worked well?',
  'What sort of "glue" have you had to develop to enable usage of your architecture?',
  'Has your architecture evolved? What lessons did you learn from previous iterations?',
  "What's next for your architecture? What are you looking to do next?",
];

// Builds a realistic GitHub issue-form body: `### <label>\n\n<value>\n\n` per
// field, with `_No response_` for any field the caller did not answer.
function issueBody(answers) {
  return (
    LABELS.map(
      (label) => `### ${label}\n\n${answers[label] ?? '_No response_'}\n`,
    ).join('\n') + '\n'
  );
}

const REQUIRED_ANSWERS = {
  'Organization or Team Name': 'Acme Corp',
  'Organization Website': 'https://acme.example',
  Contact: 'Jane Doe',
  Industries: 'Retail, Logistics',
  'Relevant CNCF Projects': 'Kubernetes | | 2019 | 1.30 | Core platform.',
  'Describe your organisation': 'Acme Corp builds widgets.',
  'Brief overview of your architecture and any potential goals you are trying to achieve with it?':
    'We run a multi-region platform on Kubernetes.',
};

function fixtureIssue(overrides = {}, answers = {}) {
  return {
    number: 900,
    title: '[Reference Architecture]: Acme - Cloud Native Platform',
    html_url: 'https://github.com/cncf/endusers/issues/900',
    body: issueBody({ ...REQUIRED_ANSWERS, ...answers }),
    ...overrides,
  };
}

test('imports a labeled issue into catalog, record and docs page', () => {
  const run = runImportArchitectureIssue({ issue: fixtureIssue() });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /Imported reference architecture "acme-corp" from issue #900/,
    );

    const catalog = run.readJson('data/architectures/catalog.json');
    assert.equal(catalog.length, 1);
    assert.deepEqual(catalog[0], {
      id: 'acme-corp',
      title: 'Acme - Cloud Native Platform',
      organization: 'Acme Corp',
      summary: 'Acme Corp builds widgets.',
      industries: ['Retail', 'Logistics'],
      tags: [],
      projects: ['Kubernetes'],
      sourceUrl: 'https://github.com/cncf/endusers/issues/900',
      sourceIssue: 900,
      assets: [],
    });

    const record = run.readJson('data/architectures/records/acme-corp.json');
    assert.deepEqual(record, catalog[0]);

    const page = run.read('docs/architectures/acme-corp.md');
    assert.match(page, /^---\ntitle: "Acme - Cloud Native Platform"\n/);
    assert.match(page, /sidebar_label: "Acme Corp"/);
    assert.match(
      page,
      /import CNCFProjectCard from '@site\/src\/components\/CNCFProjectCard';/,
    );
    assert.match(page, /reference architecture issue #900/);
    assert.match(page, /## Relevant CNCF projects/);
    assert.match(
      page,
      /<CNCFProjectCard name=\{"Kubernetes"\} href=\{"https:\/\/www\.cncf\.io\/projects\/kubernetes\/"\} since=\{"2019"\} version=\{"1\.30"\} description=\{"Core platform\."\} \/>/,
    );
    assert.match(page, /## Describe your organisation/);
    assert.match(page, /Acme Corp builds widgets\./);
    // Unanswered optional sections must not render at all.
    assert.doesNotMatch(page, /## Describe your entity and\/or team/);
  } finally {
    run.cleanup();
  }
});

test('renders every answered optional section in archetype order', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      {
        'Describe your entity and/or team': 'The Platform team.',
        'Can you expand on why you are using those projects/services?':
          'They are battle-tested.',
        'What has worked well?': 'Autoscaling.',
        "What's next for your architecture? What are you looking to do next?":
          'Adopt Gateway API.',
      },
    ),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    const order = [
      '## Relevant CNCF projects',
      '## Describe your organisation',
      '## Describe your entity and/or team',
      '## Brief overview',
      '## Can you expand on why',
      '## What has worked well?',
      "## What's next",
    ].map((heading) => page.indexOf(heading));
    assert.ok(
      order.every((index, i) => i === 0 || index > order[i - 1]),
      `sections out of order: ${JSON.stringify(order)}`,
    );
  } finally {
    run.cleanup();
  }
});

test('mirrors a cncf/artwork project logo and falls back for other hosts', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      {
        'Relevant CNCF Projects':
          'Kubernetes | https://raw.githubusercontent.com/cncf/artwork/main/projects/kubernetes/icon/color/kubernetes-icon-color.svg | 2019 | 1.30 | Core platform.\n' +
          'Widget Tool | https://example.com/logo.svg | | | Not a CNCF project.',
      },
    ),
    fetchResponses: {
      'https://raw.githubusercontent.com/cncf/artwork/main/projects/kubernetes/icon/color/kubernetes-icon-color.svg':
        { status: 200, body: '<svg></svg>' },
    },
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(
      run.exists(
        'static/img/cncf-projects/kubernetes-kubernetes-icon-color.svg',
      ),
    );
    const page = run.read('docs/architectures/acme-corp.md');
    assert.match(
      page,
      /logo=\{"\/img\/cncf-projects\/kubernetes-kubernetes-icon-color\.svg"\}/,
    );
    assert.match(page, /name=\{"Widget Tool"\}/);
    assert.doesNotMatch(page, /example\.com\/logo\.svg/);
  } finally {
    run.cleanup();
  }
});

test('disambiguates an id collision with an existing catalog entry', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(),
    catalog: [
      {
        id: 'acme-corp',
        title: 'Acme - Existing Architecture',
        organization: 'Acme Corp',
        summary: '',
        industries: [],
        tags: [],
        projects: [],
        sourceUrl: 'https://github.com/cncf/architecture/tree/abc/acme',
        sourceCommit: 'a'.repeat(40),
        assets: [],
      },
    ],
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.equal(catalog.length, 2);
    const ids = catalog.map((entry) => entry.id).sort();
    assert.deepEqual(ids, ['acme-corp', 'acme-corp-900']);
    assert.ok(run.exists('docs/architectures/acme-corp-900.md'));
  } finally {
    run.cleanup();
  }
});

test('fails closed with a clear error when a required field is unanswered', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'Organization or Team Name': undefined }),
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Organization or Team Name/);
  } finally {
    run.cleanup();
  }
});

test('rejects a payload that is missing an issue body', () => {
  const run = runImportArchitectureIssue({
    issue: { number: 1, title: '[Reference Architecture]: X' },
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /does not look like an issue payload/);
  } finally {
    run.cleanup();
  }
});

test('accepts a webhook-shaped payload wrapped in an `issue` field', () => {
  const run = runImportArchitectureIssue({
    issue: { issue: fixtureIssue(), action: 'labeled' },
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.exists('docs/architectures/acme-corp.md'));
  } finally {
    run.cleanup();
  }
});
// A submitter controls every free-text answer, and the generated page is
// compiled as MDX, where `{...}` is a JavaScript expression, a JSX element
// carries live React props, and a block-initial `import`/`export` is a
// top-level ESM statement. All three execute during the production build the
// submission workflow runs, and the JSX props then fire in visitors'
// browsers, so none may survive into the page.

test('neutralizes a brace expression in an answer', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'What has worked well?': 'Fine. {2 + 2}' }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.ok(!page.includes('{2 + 2}'), page);
    assert.match(page, /Fine\. &#123;2 \+ 2&#125;/);
  } finally {
    run.cleanup();
  }
});

test('neutralizes a JSX event handler in an answer', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      { 'What has not worked well?': '<img src="x" onError={alert(1)} />' },
    ),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.ok(!page.includes('<img'), page);
    assert.ok(!page.includes('onError={'), page);
  } finally {
    run.cleanup();
  }
});

test('neutralizes a top-level ESM statement in an answer', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      {
        'Describe your organisation':
          'Acme Corp builds widgets.\n\nexport const pwn = 1;\n\nimport fs from "node:fs";',
      },
    ),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.ok(!/^export const pwn/m.test(page), page);
    assert.ok(!/^import fs from/m.test(page), page);
    assert.match(page, /^&#101;xport const pwn = 1;$/m);
    assert.match(page, /^&#105;mport fs from "node:fs";$/m);
  } finally {
    run.cleanup();
  }
});

test('keeps the generated CNCFProjectCard import and cards intact', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'What has worked well?': 'Braces {here}.' }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    // The escaping applies to submitted answers only; the page's own MDX
    // scaffolding is generated by this script and must still be active.
    assert.match(
      page,
      /^import CNCFProjectCard from '@site\/src\/components\/CNCFProjectCard';$/m,
    );
    assert.match(page, /<CNCFProjectCard name=\{"Kubernetes"\}/);
  } finally {
    run.cleanup();
  }
});

test('leaves a code snippet in an answer verbatim', () => {
  const snippet =
    'Our config:\n\n```yaml\nresources: { limits: { cpu: "1" } }\n```\n\nand `{"a": 1}` inline.';
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'What has worked well?': snippet }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.match(page, /resources: \{ limits: \{ cpu: "1" \} \}/);
    assert.match(page, /`\{"a": 1\}` inline\./);
  } finally {
    run.cleanup();
  }
});

test('keeps the catalog summary free of the escaping character references', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      {
        'Describe your organisation': 'Acme runs {many} clusters, <10 regions.',
      },
    ),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/acme-corp.json');
    assert.equal(record.summary, 'Acme runs {many} clusters, <10 regions.');
  } finally {
    run.cleanup();
  }
});

// How .github/workflows/architecture-submission.yml actually invokes the
// script: it sets no --issue-json, and the runner supplies GITHUB_EVENT_PATH.
test('falls back to GITHUB_EVENT_PATH when --issue-json is absent', () => {
  const run = runImportArchitectureIssue({
    issue: { issue: fixtureIssue(), action: 'labeled' },
    passIssueJson: false,
    env: { GITHUB_EVENT_PATH: '{issuePath}' },
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.exists('docs/architectures/acme-corp.md'));
  } finally {
    run.cleanup();
  }
});

test('fails when neither --issue-json nor GITHUB_EVENT_PATH is set', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(),
    passIssueJson: false,
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /No issue JSON to read/);
  } finally {
    run.cleanup();
  }
});

// The workflow names the generated pull request from this value, so an
// unwritten or misspelled key silently degrades the PR title.
test('publishes the generated id to GITHUB_OUTPUT for the workflow', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(),
    env: { GITHUB_OUTPUT: '{issuePath}.output' },
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(`${run.issuePath}.output`, 'utf8'),
      'id=acme-corp\n',
    );
  } finally {
    run.cleanup();
  }
});

test('names the unanswered required body section in the error', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'Describe your organisation': undefined }),
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(
      run.stderr,
      /Issue body is missing a response for "Describe your organisation"/,
    );
  } finally {
    run.cleanup();
  }
});

// An unanswered field still renders a `### <label>` heading, so a *missing*
// heading means the body was not produced by the current issue template —
// a hand-written issue, or one opened before a template rename.
test('fails when a template field heading is absent from the body entirely', () => {
  const body = issueBody(REQUIRED_ANSWERS)
    .split('### Industries')
    .join('### Industries (renamed)');
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({ body }),
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Issue body is missing the "Industries" field/);
  } finally {
    run.cleanup();
  }
});

test('derives sourceUrl from the issue number when html_url is absent', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({ html_url: undefined }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const record = run.readJson('data/architectures/records/acme-corp.json');
    assert.equal(
      record.sourceUrl,
      'https://github.com/cncf/endusers/issues/900',
    );
  } finally {
    run.cleanup();
  }
});

// An organization name of punctuation alone slugifies to the empty string.
// The id still has to be a usable route segment and filename, so it falls
// back to the issue number rather than producing `.md` with no stem.
test('falls back to an issue-number id when the org name has no slug characters', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'Organization or Team Name': '!!!' }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.exists('docs/architectures/issue-900.md'));
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.equal(catalog[0].id, 'issue-900');
    assert.equal(catalog[0].organization, '!!!');
  } finally {
    run.cleanup();
  }
});

test('falls back to an issue-number id even when a catalog already exists', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'Organization or Team Name': '!!!' }),
    catalog: [],
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.exists('docs/architectures/issue-900.md'));
  } finally {
    run.cleanup();
  }
});

test('omits the projects section when no CNCF projects are listed', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({}, { 'Relevant CNCF Projects': undefined }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.doesNotMatch(page, /## Relevant CNCF projects/);
    assert.doesNotMatch(page, /CNCFProjectCard name=/);
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.deepEqual(catalog[0].projects, []);
    // The summary must still come from the first prose section.
    assert.equal(catalog[0].summary, 'Acme Corp builds widgets.');
  } finally {
    run.cleanup();
  }
});

test('skips blank and commented lines in the projects field', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(
      {},
      {
        'Relevant CNCF Projects':
          '# Name | Logo URL | Using since | Current version | Description\n' +
          '\n' +
          'Kubernetes | | 2019 | 1.30 | Core platform.\n' +
          '   \n' +
          '| | | |\n' +
          'Prometheus',
      },
    ),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.deepEqual(catalog[0].projects, ['Kubernetes', 'Prometheus']);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.doesNotMatch(page, /Logo URL/);
  } finally {
    run.cleanup();
  }
});

// GitHub always emits `### <label>\n`, but a hand-edited body can end on a
// bare heading with no trailing newline; that block has no value to record.
test('ignores a trailing heading that has no response line', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({ body: issueBody(REQUIRED_ANSWERS) + '### Dangling' }),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const page = run.read('docs/architectures/acme-corp.md');
    assert.doesNotMatch(page, /Dangling/);
  } finally {
    run.cleanup();
  }
});

// A webhook payload carries `title`, but the script reads it through
// `String(issue.title ?? '')` so a payload without one cannot throw on a
// property access before the required-field check reports it. An untitled
// issue is a submission with nothing to name the page after, so it must be
// rejected by that check rather than importing as a page titled "".
test('rejects an issue payload that carries no title at all', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue({ title: undefined }),
  });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Missing required issue title/);
    assert.ok(!run.exists('data/architectures/catalog.json'));
  } finally {
    run.cleanup();
  }
});

// The disambiguation suffix must only be applied to an id a catalog entry
// already claims. A populated catalog that does not claim the slug has to
// leave it alone, or every submission after the first would import as
// `<slug>-<issue number>`.
test('keeps the slugified id when a populated catalog does not claim it', () => {
  const run = runImportArchitectureIssue({
    issue: fixtureIssue(),
    catalog: [
      {
        id: 'globex-inc',
        title: 'Globex - Existing Architecture',
        organization: 'Globex Inc',
        summary: '',
        industries: [],
        tags: [],
        projects: [],
        sourceUrl: 'https://github.com/cncf/architecture/tree/abc/globex',
        sourceCommit: 'b'.repeat(40),
        assets: [],
      },
    ],
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const catalog = run.readJson('data/architectures/catalog.json');
    assert.deepEqual(catalog.map((entry) => entry.id).sort(), [
      'acme-corp',
      'globex-inc',
    ]);
    assert.ok(run.exists('docs/architectures/acme-corp.md'));
    assert.ok(!run.exists('docs/architectures/acme-corp-900.md'));
  } finally {
    run.cleanup();
  }
});
