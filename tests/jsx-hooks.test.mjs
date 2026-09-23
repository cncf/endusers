// The module hooks in tools/jsx-hooks.mjs are what makes any src/ React module
// importable from `node --test`. They are load-bearing test infrastructure: if
// a specifier silently stops resolving, the component suites that depend on
// them fail in ways that look like component bugs. These tests pin the four
// specifier shapes the hooks are responsible for.

import assert from 'node:assert/strict';
import test from 'node:test';

import { importSource } from './helpers-jsx.mjs';
import useBaseUrl from './tools/docusaurus-stubs/useBaseUrl.mjs';

test('a CSS Modules import resolves each class name to itself', async () => {
  const { default: styles } = await importSource(
    'src/components/CNCFProjectCard/styles.module.css',
  );
  assert.equal(styles.card, 'card');
});

test('the @site alias resolves against the repository root', async () => {
  const { default: projects } = await importSource(
    'src/components/ProjectsBorn/index.js',
  );
  const tree = projects({});
  assert.equal(tree.type, 'section');
});

test('@site JSON loads without an import attribute', async () => {
  const { default: data } = await importSource('data/projects-born.json');
  assert.ok(Array.isArray(data) || typeof data === 'object');
});

test('an unstubbed @docusaurus alias is left to the default resolver', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  const sentinel = { url: 'deferred', shortCircuit: true };
  const next = () => sentinel;
  assert.equal(hooks.resolve('@docusaurus/router', {}, next), sentinel);
  assert.notEqual(hooks.resolve('@docusaurus/Link', {}, next), sentinel);
});

test('useBaseUrl leaves absolute and protocol-relative URLs untouched', () => {
  assert.equal(useBaseUrl('https://cncf.io/a.svg'), 'https://cncf.io/a.svg');
  assert.equal(useBaseUrl('//cdn.example/a.svg'), '//cdn.example/a.svg');
});

test('useBaseUrl normalises a site-relative path to one leading slash', () => {
  assert.equal(useBaseUrl('img/a.svg'), '/img/a.svg');
  assert.equal(useBaseUrl('/img/a.svg'), '/img/a.svg');
});

test('useBaseUrl passes an empty or absent path straight through', () => {
  assert.equal(useBaseUrl(''), '');
  assert.equal(useBaseUrl(undefined), undefined);
});

test('the Link stub renders an anchor and maps `to` onto href', async () => {
  const { default: Link } = await importSource(
    'tests/tools/docusaurus-stubs/Link.mjs',
  );
  const element = Link({ to: '/community', className: 'x', children: 'Go' });
  assert.equal(element.type, 'a');
  assert.equal(element.props.href, '/community');
  assert.equal(element.props.className, 'x');
});

test('a @site alias naming a directory resolves to its index file', async () => {
  // src/theme/Footer imports '@site/src/components/ProjectsBorn', which
  // webpack completes to .../ProjectsBorn/index.js. Without that completion
  // the hooks hand Node a directory and the import dies with EISDIR.
  const hooks = await import('./tools/jsx-hooks.mjs');
  const next = () => {
    throw new Error('the @site alias must be resolved by the hooks');
  };
  const { url } = hooks.resolve('@site/src/components/ProjectsBorn', {}, next);
  assert.match(url, /\/src\/components\/ProjectsBorn\/index\.js$/);
});

test('a @site alias with no extension resolves to the matching source file', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  const next = () => {
    throw new Error('the @site alias must be resolved by the hooks');
  };
  const { url } = hooks.resolve('@site/src/lib/profile-links.mjs', {}, next);
  assert.match(url, /\/src\/lib\/profile-links\.mjs$/);
  assert.match(
    hooks.resolve('@site/sidebars', {}, next).url,
    /\/sidebars\.js$/,
  );
});

test('an unresolvable @site alias still names the requested path', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  const next = () => {
    throw new Error('the @site alias must be resolved by the hooks');
  };
  const { url } = hooks.resolve('@site/src/components/NoSuchThing', {}, next);
  assert.match(url, /\/src\/components\/NoSuchThing$/);
});

test('an extensionless relative import resolves to the matching source file', async () => {
  // src/components/CommunityPeople/index.js imports '../hooks/useFocusTrap',
  // which webpack completes to .../useFocusTrap.js. Node's resolver does not,
  // so without this completion the component cannot be imported at all.
  const hooks = await import('./tools/jsx-hooks.mjs');
  const next = () => {
    throw new Error('the relative specifier must be resolved by the hooks');
  };
  const parentURL = new URL(
    '../src/components/CommunityPeople/index.js',
    import.meta.url,
  ).href;
  const { url } = hooks.resolve('../hooks/useFocusTrap', { parentURL }, next);
  assert.match(url, /\/src\/components\/hooks\/useFocusTrap\.js$/);
});

test('a relative import that already names a file is left to Node', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  let delegated = false;
  const next = () => {
    delegated = true;
    return { url: 'file:///delegated' };
  };
  hooks.resolve('./helpers-jsx.mjs', { parentURL: import.meta.url }, next);
  assert.equal(delegated, true, 'an existing file must reach the next hook');
});

test('an unresolvable relative import is left to Node to report', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  let delegated = false;
  const next = () => {
    delegated = true;
    return { url: 'file:///delegated' };
  };
  hooks.resolve('./no-such-module', { parentURL: import.meta.url }, next);
  assert.equal(delegated, true, 'a miss must not be short-circuited');
});

test('a relative import from node_modules is never intercepted', async () => {
  const hooks = await import('./tools/jsx-hooks.mjs');
  let delegated = false;
  const next = () => {
    delegated = true;
    return { url: 'file:///delegated' };
  };
  hooks.resolve(
    './anything',
    { parentURL: 'file:///repo/node_modules/pkg/index.js' },
    next,
  );
  assert.equal(delegated, true, 'dependency resolution must be untouched');
});
