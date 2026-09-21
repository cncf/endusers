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

test('the pull request template is present and non-empty', () => {
  const body = readFileSync(
    repoPath('.github/PULL_REQUEST_TEMPLATE.md'),
    'utf8',
  );
  assert.notEqual(
    body.trim(),
    '',
    '.github/PULL_REQUEST_TEMPLATE.md must not be empty',
  );
});
