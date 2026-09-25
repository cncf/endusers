import test from 'node:test';
import assert from 'node:assert/strict';

import { jsxAttribute, jsxElement } from '../scripts/lib/jsx-attributes.mjs';

test('renders an attribute in expression form', () => {
  assert.equal(jsxAttribute('since', '2019'), ' since={"2019"}');
  assert.equal(jsxAttribute('name', 'Kubernetes'), ' name={"Kubernetes"}');
});

test('a value containing a quote stays inside the expression', () => {
  // The bug this module exists for: a quoted attribute would end at the `"`
  // and everything after it would be parsed as further JSX attributes.
  const hostile =
    '2019" dangerouslySetInnerHTML={{__html: globalThis.PWNED = 1}} />';
  const rendered = jsxAttribute('since', hostile);

  assert.equal(rendered, ` since={${JSON.stringify(hostile)}}`);
  // The payload is a string literal, so the only unescaped quotes are the two
  // delimiting it.
  assert.equal(rendered.replace(/\\"/g, '').match(/"/g).length, 2);
});

test('values containing JSX and JS metacharacters round-trip unchanged', () => {
  for (const value of [
    'brace } and brace {',
    'backslash \\ and quote "',
    'newline\nand\ttab',
    '</CNCFProjectCard>',
    '<script>globalThis.PWNED = 1</script>',
    "single ' and backtick `",
  ]) {
    const rendered = jsxAttribute('description', value);
    const literal = rendered.slice(' description={'.length, -1);
    assert.equal(JSON.parse(literal), value);
  }
});

test('rejects an attribute name that is not a plain identifier', () => {
  for (const name of ['a b', 'a="x"', '', 'a/>', '1a']) {
    assert.throws(() => jsxAttribute(name, 'x'), /Unsafe JSX attribute name/);
  }
});

test('rejects an element name that is not a plain identifier', () => {
  for (const element of ['a b', 'div onclick=x', '', '<div']) {
    assert.throws(() => jsxElement(element, {}), /Unsafe JSX element name/);
  }
});

test('renders a self-closing element with every supplied attribute', () => {
  assert.equal(
    jsxElement('CNCFProjectCard', {
      name: 'Helm',
      href: 'https://www.cncf.io/projects/helm/',
      since: '2019',
    }),
    '<CNCFProjectCard name={"Helm"} href={"https://www.cncf.io/projects/helm/"} since={"2019"} />',
  );
});

test('omits absent optional attributes rather than rendering them empty', () => {
  assert.equal(
    jsxElement('CNCFProjectCard', {
      name: 'Argo',
      logo: null,
      since: undefined,
      version: '',
      description: 'text',
    }),
    '<CNCFProjectCard name={"Argo"} description={"text"} />',
  );
});

test('an element with no attributes still self-closes', () => {
  assert.equal(jsxElement('CNCFProjectCard', {}), '<CNCFProjectCard />');
});
