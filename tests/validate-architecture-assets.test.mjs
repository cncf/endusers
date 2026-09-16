import assert from 'node:assert/strict';
import test from 'node:test';
import { runScriptWithFixtures } from './helpers.mjs';

const SCRIPT = 'validate-architecture-assets.mjs';

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';

function svgFixture(svg, name = 'diagram.svg') {
  return { [`static/img/architectures/example/${name}`]: svg };
}

test('accepts a valid SVG', () => {
  const result = runScriptWithFixtures(SCRIPT, svgFixture(VALID_SVG));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 architecture asset/);
});

test('validates zero assets when the directory is absent', () => {
  const result = runScriptWithFixtures(SCRIPT, {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 0 architecture asset/);
});

test('rejects SVG without the SVG namespace', () => {
  const svg = '<svg viewBox="0 0 100 100"><rect/></svg>';
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing xmlns/);
});

test('rejects SVG with a DOCTYPE declaration', () => {
  const svg = `<!DOCTYPE svg>\n${VALID_SVG}`;
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DOCTYPE/);
});

test('rejects SVG missing viewBox but reports resolvable dimensions', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect/></svg>';
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /missing viewBox attribute \(has width=100, height=50\)/,
  );
});

test('rejects SVG missing viewBox and dimensions', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /missing viewBox attribute and resolvable width\/height/,
  );
});

test('rejects SVG with embedded raster data', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<image href="data:image/png;base64,AAAA"/>',
  );
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /embedded raster image data/);
});

test('warns on draw.io mxfile metadata but still passes', () => {
  const svg = VALID_SVG.replace('<svg ', '<svg content="&lt;mxfile&gt;" ');
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /mxfile metadata/);
  assert.match(result.stdout, /Validated 1 architecture asset/);
});

test('warns on foreignObject but still passes', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<foreignObject width="10" height="10"><p>label</p></foreignObject>',
  );
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /foreignObject/);
  assert.match(result.stdout, /Validated 1 architecture asset/);
});

test('walks nested directories', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures/a/one.svg': VALID_SVG,
    'static/img/architectures/b/deep/two.svg': VALID_SVG,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 architecture asset/);
});
