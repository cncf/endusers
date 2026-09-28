import { test } from 'node:test';
import assert from 'node:assert/strict';
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
