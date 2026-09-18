import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// Docusaurus fails the blog build outright when a post references an author or
// tag key that is absent from blog/authors.yml or blog/tags.yml. Nothing in
// `npm run check` catches that before a deploy, so assert the contract here.

const blogDir = new URL('../blog/', import.meta.url).pathname;

const authors = parse(readFileSync(join(blogDir, 'authors.yml'), 'utf8'));
const tags = parse(readFileSync(join(blogDir, 'tags.yml'), 'utf8'));

const POST_FILENAME = /^(\d{4}-\d{2}-\d{2})-(.+)\.mdx?$/;

const postFiles = readdirSync(blogDir)
  .filter((name) => POST_FILENAME.test(name))
  .sort();

function readFrontmatter(file) {
  const source = readFileSync(join(blogDir, file), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, `${file}: missing a YAML frontmatter block`);
  return { frontmatter: parse(match[1]), source };
}

test('blog/ contains at least one post', () => {
  assert.ok(
    postFiles.length > 0,
    'expected blog posts named YYYY-MM-DD-<slug>.md',
  );
});

test('every post author key is defined in blog/authors.yml', () => {
  for (const file of postFiles) {
    const { frontmatter } = readFrontmatter(file);
    const declared = frontmatter.authors;
    assert.ok(declared, `${file}: frontmatter has no authors`);
    const keys = Array.isArray(declared) ? declared : [declared];
    assert.ok(keys.length > 0, `${file}: authors list is empty`);
    for (const key of keys) {
      // Inline author objects are legal in Docusaurus; only keys need lookup.
      if (typeof key !== 'string') continue;
      assert.ok(
        Object.hasOwn(authors, key),
        `${file}: author "${key}" is not defined in blog/authors.yml`,
      );
    }
  }
});

test('every post tag key is defined in blog/tags.yml', () => {
  for (const file of postFiles) {
    const { frontmatter } = readFrontmatter(file);
    const declared = frontmatter.tags ?? [];
    const keys = Array.isArray(declared) ? declared : [declared];
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      assert.ok(
        Object.hasOwn(tags, key),
        `${file}: tag "${key}" is not defined in blog/tags.yml`,
      );
    }
  }
});

test('every post declares a title and a slug matching its filename', () => {
  for (const file of postFiles) {
    const { frontmatter } = readFrontmatter(file);
    assert.ok(frontmatter.title, `${file}: frontmatter has no title`);
    assert.ok(frontmatter.slug, `${file}: frontmatter has no slug`);
    const [, , filenameSlug] = file.match(POST_FILENAME);
    assert.equal(
      frontmatter.slug,
      filenameSlug,
      `${file}: slug must match the filename portion after the date prefix`,
    );
  }
});

test('post slugs are unique', () => {
  const seen = new Map();
  for (const file of postFiles) {
    const { frontmatter } = readFrontmatter(file);
    const previous = seen.get(frontmatter.slug);
    assert.equal(
      previous,
      undefined,
      `slug "${frontmatter.slug}" is used by both ${previous} and ${file}`,
    );
    seen.set(frontmatter.slug, file);
  }
});

test('every post has a truncate marker so list pages show an excerpt', () => {
  for (const file of postFiles) {
    const { source } = readFrontmatter(file);
    assert.match(
      source,
      /\{\/\*\s*truncate\s*\*\/\}|<!--\s*truncate\s*-->/,
      `${file}: no truncate marker, so the blog list page renders the whole post`,
    );
  }
});

test('every authors.yml entry has the fields the author card renders', () => {
  for (const [key, author] of Object.entries(authors)) {
    assert.ok(author && typeof author === 'object', `${key}: not a mapping`);
    assert.ok(author.name, `${key}: missing name`);
    assert.ok(author.title, `${key}: missing title`);
    assert.ok(author.url, `${key}: missing url`);
    assert.ok(author.image_url, `${key}: missing image_url`);
    for (const field of ['url', 'image_url']) {
      assert.match(
        author[field],
        /^https:\/\//,
        `${key}: ${field} must be an https URL`,
      );
    }
  }
});

test('every tags.yml entry has a label and a description', () => {
  for (const [key, tag] of Object.entries(tags)) {
    assert.ok(tag && typeof tag === 'object', `${key}: not a mapping`);
    assert.ok(tag.label, `${key}: missing label`);
    assert.ok(tag.description, `${key}: missing description`);
  }
});
