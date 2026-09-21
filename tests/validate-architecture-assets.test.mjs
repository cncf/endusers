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

test('rejects a non-image asset type', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures/example/notes.html': '<script>alert(1)</script>',
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\.html is not an allowed asset type; static\/ is served at the site origin/,
  );
});

test('rejects an extensionless asset', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures/example/README': 'hello',
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /extensionless file is not an allowed asset type/,
  );
});

test('walks nested directories', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures/a/one.svg': VALID_SVG,
    'static/img/architectures/b/deep/two.svg': VALID_SVG,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 2 architecture asset/);
});

// --- --fix mode -----------------------------------------------------------
// `npm run validate:architecture-assets -- --fix` rewrites assets in place.
// These cases pin which findings are repaired, which are reported untouched,
// and what lands on disk afterwards.

const ASSET = 'static/img/architectures/example/diagram.svg';

function runFix(svg, extraFixtures = {}) {
  return runScriptWithFixtures(
    SCRIPT,
    { ...svgFixture(svg), ...extraFixtures },
    { args: ['--fix'], readBack: [ASSET] },
  );
}

test('--fix leaves a valid SVG untouched', () => {
  const result = runFix(VALID_SVG);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.doesNotMatch(result.stdout, /Fixed \d+ issue/);
  assert.match(result.stdout, /No fixes were needed\./);
});

test('--fix removes a DOCTYPE declaration instead of reporting it', () => {
  const svg = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">\n${VALID_SVG}`;
  const result = runFix(svg);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.files[ASSET], /DOCTYPE/);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.match(result.stdout, /Fixed 1 issue\(s\)/);
  assert.match(result.stdout, /removed DOCTYPE/);
});

test('--fix adds a viewBox derived from width and height', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>';
  const result = runFix(svg);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.files[ASSET], /<svg viewBox="0 0 640 480"/);
  assert.match(result.stdout, /added viewBox="0 0 640 480"/);
});

test('--fix parses fractional and unit-suffixed dimensions for the viewBox', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640.5px" height="480px"><rect/></svg>';
  const result = runFix(svg);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.files[ASSET], /viewBox="0 0 640\.5 480"/);
});

test('--fix cannot repair a missing viewBox without dimensions', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const result = runFix(svg);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing viewBox attribute and resolvable/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix strips draw.io mxfile metadata that would otherwise warn', () => {
  const svg = VALID_SVG.replace(
    '<svg ',
    '<svg content="&lt;mxfile host=&quot;app&quot;&gt;" ',
  );
  const result = runFix(svg);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.files[ASSET], /mxfile/);
  assert.doesNotMatch(result.stderr, /mxfile/);
  assert.match(result.stdout, /stripped draw\.io mxfile metadata/);
});

test('--fix does not suppress a missing xmlns, and leaves the file alone', () => {
  const svg = '<svg viewBox="0 0 100 100"><rect/></svg>';
  const result = runFix(svg);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing xmlns/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix does not suppress embedded raster data', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<image href="data:image/png;base64,AAAA"/>',
  );
  const result = runFix(svg);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /embedded raster image data/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix repairs several findings in one file and reports each', () => {
  const svg =
    '<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect/></svg>';
  const result = runFix(svg);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Fixed 2 issue\(s\)/);
  assert.doesNotMatch(result.files[ASSET], /DOCTYPE/);
  assert.match(result.files[ASSET], /viewBox="0 0 10 20"/);
});

test('--fix writes a repair to each asset it walks', () => {
  const second = 'static/img/architectures/nested/deep/two.svg';
  const result = runScriptWithFixtures(
    SCRIPT,
    {
      ...svgFixture(`<!DOCTYPE svg>\n${VALID_SVG}`),
      [second]: `<!DOCTYPE svg>\n${VALID_SVG}`,
    },
    { args: ['--fix'], readBack: [ASSET, second] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Fixed 2 issue\(s\)/);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.equal(result.files[second], VALID_SVG);
});

test('--fix ignores non-SVG assets', () => {
  const png = 'static/img/architectures/example/shot.png';
  const result = runScriptWithFixtures(
    SCRIPT,
    { [png]: 'not really a png' },
    { args: ['--fix'], readBack: [png] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.files[png], 'not really a png');
  assert.match(result.stdout, /Validated 1 architecture asset/);
});
