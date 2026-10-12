// The `isCncfProjectHref(href) ? href : null` guard in
// renderProjectsSection() (scripts/import-architecture-issue.mjs).
//
// "Relevant CNCF Projects" is a free-text issue-form field. Its first
// pipe-separated column is slugged straight into
// `https://www.cncf.io/projects/<slug>/`, so the submitter controls part of a
// URL that the generated page renders as a link. isCncfProjectHref() is the
// check that the result still addresses the CNCF projects namespace, and the
// `: null` arm is what happens when it does not: jsxElement() drops a null
// attribute, so the card renders without an href rather than with an
// attacker-chosen one.
//
// tests/import-architecture-issue.test.mjs only ever submits ordinary project
// names, so that arm had never been taken -- the whole importer suite passed
// with the guard reduced to a bare `href`. tests/project-card-links.test.mjs
// covers isCncfProjectHref() as a predicate, but nothing connected it to the
// importer, which is the only place submitter text reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImportArchitectureIssue } from './helpers-import-issue-sandbox.mjs';

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

const ANSWERS = {
  'Organization or Team Name': 'Acme Corp',
  'Organization Website': 'https://acme.example',
  Contact: 'Jane Doe',
  Industries: 'Retail',
  'Describe your organisation': 'Acme Corp builds widgets.',
  'Brief overview of your architecture and any potential goals you are trying to achieve with it?':
    'We run a multi-region platform on Kubernetes.',
};

function issueWithProjects(projectsField) {
  const answers = { ...ANSWERS, 'Relevant CNCF Projects': projectsField };
  return {
    number: 901,
    title: '[Reference Architecture]: Acme - Cloud Native Platform',
    html_url: 'https://github.com/cncf/endusers/issues/901',
    body:
      LABELS.map(
        (label) => `### ${label}\n\n${answers[label] ?? '_No response_'}\n`,
      ).join('\n') + '\n',
  };
}

function importedPage(projectsField) {
  const run = runImportArchitectureIssue({
    issue: issueWithProjects(projectsField),
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    return run.read('docs/architectures/acme-corp.md');
  } finally {
    run.cleanup();
  }
}

test('drops the href when a project name escapes the /projects/ path', () => {
  // `../` survives the slug transform (it only collapses whitespace), and the
  // WHATWG URL parser resolves the dot segments, so the built href leaves the
  // projects namespace entirely: https://www.cncf.io/blog/.
  const page = importedPage(
    '../../blog | | 2019 | 1.30 | Not really a project.',
  );

  assert.match(page, /## Relevant CNCF projects/);
  // The card is still rendered -- the submission is not discarded, only the
  // link is withheld.
  assert.match(page, /<CNCFProjectCard name=\{"\.\.\/\.\.\/blog"\}/);
  assert.doesNotMatch(page, /href=/);
  // Belt and braces: whatever the guard did, no /blog link may appear.
  assert.doesNotMatch(page, /www\.cncf\.io\/blog/);
});

test('keeps the rest of the card when the href is withheld', () => {
  const page = importedPage('../evil | | 2020 | 2.1 | Still described.');

  assert.match(
    page,
    /<CNCFProjectCard name=\{"\.\.\/evil"\} since=\{"2020"\} version=\{"2\.1"\} description=\{"Still described\."\} \/>/,
  );
});

test('still links a project name that stays inside /projects/', () => {
  // The companion case, asserted here rather than relied on from the main
  // suite: the guard has to reject the traversal above without also
  // suppressing an ordinary link, which is the failure a too-strict fix
  // would introduce.
  const page = importedPage('Kubernetes | | 2019 | 1.30 | Core platform.');

  assert.match(
    page,
    /<CNCFProjectCard name=\{"Kubernetes"\} href=\{"https:\/\/www\.cncf\.io\/projects\/kubernetes\/"\}/,
  );
});

test('withholds only the offending card in a mixed submission', () => {
  const page = importedPage(
    [
      'Kubernetes | | 2019 | 1.30 | Core platform.',
      '../../blog | | 2021 | 3.0 | Not really a project.',
    ].join('\n'),
  );

  assert.match(
    page,
    /<CNCFProjectCard name=\{"Kubernetes"\} href=\{"https:\/\/www\.cncf\.io\/projects\/kubernetes\/"\}/,
  );
  assert.match(
    page,
    /<CNCFProjectCard name=\{"\.\.\/\.\.\/blog"\} since=\{"2021"\}/,
  );
  // Exactly one href across both cards.
  assert.equal((page.match(/href=\{/g) ?? []).length, 1);
});
