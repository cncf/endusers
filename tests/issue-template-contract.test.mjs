import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = new URL('..', import.meta.url);

function repoPath(relativePath) {
  return fileURLToPath(new URL(relativePath, repoRoot));
}

function readYaml(relativePath) {
  return parse(readFileSync(repoPath(relativePath), 'utf8'));
}

const TEMPLATE_DIR = '.github/ISSUE_TEMPLATE/';

const templateFiles = readdirSync(repoPath(TEMPLATE_DIR))
  .filter((name) => /\.ya?ml$/.test(name))
  .filter((name) => name !== 'config.yml')
  .sort();

const templates = templateFiles.map((name) => ({
  name,
  path: `${TEMPLATE_DIR}${name}`,
  form: readYaml(`${TEMPLATE_DIR}${name}`),
}));

// GitHub rejects an issue form outright when these are absent or when a body
// element uses an unknown type, and the rejection only surfaces to a
// contributor trying to open the issue.
const FORM_ELEMENT_TYPES = new Set([
  'markdown',
  'input',
  'textarea',
  'dropdown',
  'checkboxes',
]);

test('the repository ships at least one issue form', () => {
  assert.ok(templates.length > 0, `expected issue forms under ${TEMPLATE_DIR}`);
});

test('every issue form declares name, description and a body', () => {
  for (const { path, form } of templates) {
    assert.equal(typeof form?.name, 'string', `${path}: missing name`);
    assert.notEqual(form.name.trim(), '', `${path}: empty name`);
    assert.equal(
      typeof form.description,
      'string',
      `${path}: missing description`,
    );
    assert.notEqual(form.description.trim(), '', `${path}: empty description`);
    assert.ok(Array.isArray(form.body), `${path}: body must be a list`);
    assert.ok(form.body.length > 0, `${path}: body must not be empty`);
  }
});

test('every issue form labels field is a list of non-empty strings', () => {
  for (const { path, form } of templates) {
    if (form.labels === undefined) continue;
    assert.ok(Array.isArray(form.labels), `${path}: labels must be a list`);
    for (const label of form.labels) {
      assert.equal(typeof label, 'string', `${path}: non-string label`);
      assert.notEqual(label.trim(), '', `${path}: empty label`);
    }
  }
});

test('every form element uses a supported type', () => {
  for (const { path, form } of templates) {
    for (const [index, element] of form.body.entries()) {
      assert.ok(
        FORM_ELEMENT_TYPES.has(element?.type),
        `${path}: body[${index}] has unsupported type ${JSON.stringify(element?.type)}`,
      );
    }
  }
});

test('every non-markdown form element has a unique id and a label', () => {
  for (const { path, form } of templates) {
    const seen = new Set();
    for (const [index, element] of form.body.entries()) {
      if (element.type === 'markdown') {
        assert.equal(
          typeof element.attributes?.value,
          'string',
          `${path}: body[${index}] markdown element needs attributes.value`,
        );
        continue;
      }
      assert.equal(
        typeof element.id,
        'string',
        `${path}: body[${index}] (${element.type}) needs an id`,
      );
      assert.ok(
        !seen.has(element.id),
        `${path}: duplicate element id "${element.id}"`,
      );
      seen.add(element.id);
      assert.equal(
        typeof element.attributes?.label,
        'string',
        `${path}: element "${element.id}" needs attributes.label`,
      );
      assert.notEqual(
        element.attributes.label.trim(),
        '',
        `${path}: element "${element.id}" has an empty label`,
      );
    }
  }
});

test('every dropdown offers a non-empty list of unique options', () => {
  for (const { path, form } of templates) {
    for (const element of form.body) {
      if (element.type !== 'dropdown') continue;
      const options = element.attributes?.options;
      assert.ok(
        Array.isArray(options) && options.length > 0,
        `${path}: dropdown "${element.id}" needs attributes.options`,
      );
      assert.equal(
        new Set(options).size,
        options.length,
        `${path}: dropdown "${element.id}" repeats an option`,
      );
    }
  }
});

test('the blog-post form exists and collects title, content and author', () => {
  const blogPost = templates.find(({ name }) => name === 'blog-post.yml');
  assert.ok(blogPost, `${TEMPLATE_DIR}blog-post.yml is missing`);
  const ids = blogPost.form.body
    .filter((element) => element.type !== 'markdown')
    .map((element) => element.id);
  for (const required of ['title', 'content', 'author']) {
    assert.ok(
      ids.includes(required),
      `${blogPost.path}: expected a "${required}" field, got ${ids.join(', ')}`,
    );
  }
});

// A dropdown option that does not resolve in blog/authors.yml becomes a post
// frontmatter author key Docusaurus cannot resolve, which fails `npm run
// build`. This asserts only the option -> authors.yml direction; the field
// contract of blog/authors.yml entries themselves is not asserted here.
test('every blog-post author option resolves in blog/authors.yml', () => {
  const blogPost = templates.find(({ name }) => name === 'blog-post.yml');
  assert.ok(blogPost, `${TEMPLATE_DIR}blog-post.yml is missing`);
  const authorField = blogPost.form.body.find(
    (element) => element.id === 'author',
  );
  assert.equal(
    authorField?.type,
    'dropdown',
    `${blogPost.path}: author field must be a dropdown`,
  );

  const authorKeys = new Set(Object.keys(readYaml('blog/authors.yml')));
  const unknown = authorField.attributes.options.filter(
    (option) => !authorKeys.has(option),
  );
  assert.deepEqual(
    unknown,
    [],
    `${blogPost.path}: author options absent from blog/authors.yml: ${unknown.join(', ')}`,
  );
});

const PULL_REQUEST_TEMPLATE = '.github/PULL_REQUEST_TEMPLATE.md';

test('the pull request template is present and non-empty', () => {
  const body = readFileSync(repoPath(PULL_REQUEST_TEMPLATE), 'utf8');
  assert.notEqual(
    body.trim(),
    '',
    `${PULL_REQUEST_TEMPLATE} must not be empty`,
  );
});

// These templates are read in two different places, and a relative link only
// works in one of them. In the file viewer `../CONTRIBUTING.md` resolves, which
// is what anyone editing the template sees. Where the template is actually
// read it does not: GitHub prefills it into a pull request body, and a
// relative target there is resolved against the /compare URL the contributor
// is on rather than against the repository, so the link 404s. An absolute URL
// is the only form that works in both views.
//
// Nothing else in the repository would notice. `npm run check:links` is
// `for f in *.md` (package.json, `_check:links-md`), so it iterates root-level
// markdown and never descends into .github/; `npm run check:markdown` lints
// style, not resolution.
//
// This asserts link *form*, not link *liveness*. Resolving targets over the
// network is exactly what `check:links` is exempted from CI for in
// tests/workflow-scripts.test.mjs (GATES_NOT_RUN_BY_CI): a third-party outage
// must not fail an unrelated pull request. The same reasoning applies here, so
// a target is judged by its shape alone.
//
// Strips HTML comments first: they are not rendered, so a link parked inside
// one is not shown to anybody.
function markdownLinkTargets(text) {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
  const targets = [];
  // Title-bearing forms such as [a](https://x "t") are matched so the title is
  // not mistaken for part of the target.
  const pattern = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const match of withoutComments.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

function badLinkTarget(target) {
  if (target.startsWith('#')) return null;
  if (target.startsWith('https://')) return null;
  if (target.startsWith('http://')) {
    return `${target} must use https://`;
  }
  return `${target} is relative; GitHub resolves it against the /compare URL when the template is rendered into a body, not against the repository`;
}

// The markdown GitHub renders out of an issue form: the form's own description
// and, per element, the markdown blocks and the help text under a field.
function renderedFormText(form) {
  const chunks = [];
  if (typeof form.description === 'string') chunks.push(form.description);
  for (const element of form.body) {
    const { value, description } = element.attributes;
    if (element.type === 'markdown' && typeof value === 'string') {
      chunks.push(value);
    }
    if (typeof description === 'string') chunks.push(description);
  }
  return chunks;
}

function formLinkProblems(path, form) {
  const problems = [];
  for (const chunk of renderedFormText(form)) {
    for (const target of markdownLinkTargets(chunk)) {
      const problem = badLinkTarget(target);
      if (problem !== null) problems.push(`${path}: ${problem}`);
    }
  }
  return problems;
}

test('the pull request template links only with absolute URLs or anchors', () => {
  const body = readFileSync(repoPath(PULL_REQUEST_TEMPLATE), 'utf8');
  const problems = markdownLinkTargets(body)
    .map(badLinkTarget)
    .filter((problem) => problem !== null);
  assert.deepEqual(
    problems,
    [],
    `${PULL_REQUEST_TEMPLATE}: unusable link targets:\n${problems.join('\n')}`,
  );
});

test('every issue form links only with absolute URLs or anchors', () => {
  const problems = templates.flatMap(({ path, form }) =>
    formLinkProblems(path, form),
  );
  assert.deepEqual(
    problems,
    [],
    `issue forms carry unusable link targets:\n${problems.join('\n')}`,
  );
});

test('formLinkProblems reports a relative link anywhere a form renders markdown', () => {
  const form = {
    description: 'see [guide](../CONTRIBUTING.md)',
    body: [
      { type: 'markdown', attributes: { value: 'intro [a](./a.md)' } },
      { type: 'input', id: 'title', attributes: { label: 'Title' } },
      {
        type: 'textarea',
        id: 'content',
        attributes: { label: 'Content', description: 'help [b](b.md)' },
      },
    ],
  };
  assert.deepEqual(
    formLinkProblems('form.yml', form).map((problem) =>
      problem.replace(/ is relative;.*/, ''),
    ),
    ['form.yml: ../CONTRIBUTING.md', 'form.yml: ./a.md', 'form.yml: b.md'],
  );
  assert.deepEqual(
    formLinkProblems('form.yml', {
      description: 'see [guide](https://example.com)',
      body: [{ type: 'input', id: 'title', attributes: { label: 'Title' } }],
    }),
    [],
  );
});

// Without this the two tests above would keep passing if the templates lost
// their links altogether, or if the link syntax drifted past the matcher.
test('the templates still carry the links the guards above check', () => {
  const body = readFileSync(repoPath(PULL_REQUEST_TEMPLATE), 'utf8');
  const targets = markdownLinkTargets(body);
  assert.ok(
    targets.length > 0,
    `${PULL_REQUEST_TEMPLATE}: no markdown link found; the link-form guard is asserting nothing`,
  );
  assert.ok(
    targets.some((target) => /\/CONTRIBUTING\.md$/.test(target)),
    `${PULL_REQUEST_TEMPLATE}: expected a link to CONTRIBUTING.md, got ${JSON.stringify(targets)}`,
  );
});

test('markdownLinkTargets reads targets apart from titles and comments', () => {
  assert.deepEqual(markdownLinkTargets('see [a](https://example.com)'), [
    'https://example.com',
  ]);
  assert.deepEqual(markdownLinkTargets('[a](https://example.com "title")'), [
    'https://example.com',
  ]);
  assert.deepEqual(markdownLinkTargets('<!-- [a](../x.md) -->'), []);
  assert.deepEqual(markdownLinkTargets('- [ ] a checkbox, not a link'), []);
  assert.deepEqual(markdownLinkTargets('[a](#anchor)'), ['#anchor']);
});

test('badLinkTarget accepts anchors and absolute URLs and rejects the rest', () => {
  assert.equal(badLinkTarget('#summary'), null);
  assert.equal(badLinkTarget('https://example.com/x'), null);
  assert.match(badLinkTarget('http://example.com/x'), /must use https/);
  assert.match(badLinkTarget('../CONTRIBUTING.md'), /is relative/);
  assert.match(badLinkTarget('CONTRIBUTING.md'), /is relative/);
  assert.match(badLinkTarget('/CONTRIBUTING.md'), /is relative/);
});
