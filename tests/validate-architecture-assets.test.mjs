import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { runScriptWithFixtures } from './helpers.mjs';
import {
  assertInvalidAssets,
  assertValidAssets,
  assetDiagnostics,
  validateAssetFixtures,
} from './helpers-architecture-assets.mjs';

const SCRIPT = 'validate-architecture-assets.mjs';

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';

function svgFixture(svg, name = 'diagram.svg') {
  return { [`static/img/architectures/example/${name}`]: svg };
}

test('accepts a valid SVG', () => {
  const result = validateAssetFixtures(svgFixture(VALID_SVG));
  assertValidAssets(result);
  assert.equal(result.assetCount, 1);
});

test('accepts whitespace around namespace and viewBox attribute assignments', () => {
  const result = validateAssetFixtures(
    svgFixture(VALID_SVG.replaceAll('="', ' = "')),
  );
  assert.deepEqual(result.issues, []);
});

test('validates zero assets when the directory is absent', () => {
  const result = validateAssetFixtures({});
  assertValidAssets(result);
  assert.equal(result.assetCount, 0);
});

test('rejects SVG without the SVG namespace', () => {
  const svg = '<svg viewBox="0 0 100 100"><rect/></svg>';
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /missing xmlns/);
  assert.ok(
    result.issues.some(
      ({ severity, message }) =>
        severity === 'error' &&
        message === 'missing xmlns="http://www.w3.org/2000/svg"',
    ),
  );
});

test('rejects SVG with a DOCTYPE declaration', () => {
  const svg = `<!DOCTYPE svg>\n${VALID_SVG}`;
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /DOCTYPE/);
});

test('rejects SVG missing viewBox but reports resolvable dimensions', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect/></svg>';
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /missing viewBox attribute \(has width=100, height=50\)/,
  );
});

test('rejects SVG missing viewBox and dimensions', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /missing viewBox attribute and resolvable width\/height/,
  );
});

test('rejects SVG with embedded raster data', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<image href="data:image/png;base64,AAAA"/>',
  );
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /embedded raster image data/);
});

test('warns on draw.io mxfile metadata but still passes', () => {
  const svg = VALID_SVG.replace('<svg ', '<svg content="&lt;mxfile&gt;" ');
  const result = validateAssetFixtures(svgFixture(svg));
  assertValidAssets(result);
  assert.match(assetDiagnostics(result), /mxfile metadata/);
  assert.deepEqual(result.issues, [
    {
      path: 'static/img/architectures/example/diagram.svg',
      severity: 'warn',
      message: 'contains draw.io mxfile metadata in content attribute',
    },
  ]);
  assert.equal(result.assetCount, 1);
});

test('warns on foreignObject but still passes', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<foreignObject width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">label</p></foreignObject>',
  );
  const result = validateAssetFixtures(svgFixture(svg));
  assertValidAssets(result);
  assert.match(assetDiagnostics(result), /foreignObject/);
  assert.equal(result.assetCount, 1);
});

test('rejects a non-image asset type', () => {
  const result = validateAssetFixtures({
    'static/img/architectures/example/notes.html': '<script>alert(1)</script>',
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /\.html is not an allowed asset type; static\/ is served at the site origin/,
  );
});

test('rejects an extensionless asset', () => {
  const result = validateAssetFixtures({
    'static/img/architectures/example/README': 'hello',
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /extensionless file is not an allowed asset type/,
  );
});

test('walks nested directories', () => {
  const result = validateAssetFixtures({
    'static/img/architectures/a/one.svg': VALID_SVG,
    'static/img/architectures/b/deep/two.svg': VALID_SVG,
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 2);
});

test('rejects SVG containing a script element', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<script>alert(1)</script>',
  );
  const result = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /active content: contains a disallowed element <script>/,
  );
});

test('rejects SVG containing a script element under an uppercase .SVG extension', () => {
  // The extension allow-list lowercases before matching, so `.SVG` is accepted
  // as an SVG asset. The scan dispatch has to agree, or the file is published
  // to the site origin with no active-content scan at all.
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<script>alert(1)</script>',
  );
  const result = validateAssetFixtures(svgFixture(svg, 'diagram.SVG'));
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /active content: contains a disallowed element <script>/,
  );
});

// --- --fix mode -----------------------------------------------------------
// `npm run validate:architecture-assets -- --fix` rewrites assets in place.
// These cases pin which findings are repaired, which are reported untouched,
// and what lands on disk afterwards.

const ASSET = 'static/img/architectures/example/diagram.svg';

for (const path of [ASSET, 'static/img/cncf-projects/logo.svg']) {
  for (const fix of [false, true]) {
    test(`does not write an unchanged ${path} (fix=${fix})`, () => {
      const time = new Date('2000-01-01T00:00:00Z');
      const result = validateAssetFixtures(
        { [path]: VALID_SVG },
        {
          fix,
          readBack: [path],
          setup: (root) => utimesSync(join(root, path), time, time),
        },
      );
      assertValidAssets(result);
      assert.equal(result.mtimes[path], time.getTime());
      assert.equal(result.files[path], VALID_SVG);
      assert.deepEqual(result.fixed, []);
    });
  }
}

function runFix(svg, extraFixtures = {}) {
  return validateAssetFixtures(
    { ...svgFixture(svg), ...extraFixtures },
    { fix: true, readBack: [ASSET] },
  );
}

test('--fix leaves a valid SVG untouched', () => {
  const result = runFix(VALID_SVG);
  assertValidAssets(result);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.deepEqual(result.fixed, []);
});

test('--fix removes a DOCTYPE declaration instead of reporting it', () => {
  const svg = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">\n${VALID_SVG}`;
  const result = runFix(svg);
  assertValidAssets(result);
  assert.doesNotMatch(result.files[ASSET], /DOCTYPE/);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.equal(result.fixed.length, 1);
  assert.match(result.fixed.join('\n'), /removed DOCTYPE/);
});

test('--fix fails closed on a DOCTYPE it cannot remove', () => {
  // An unclosed internal subset matches neither stripDoctype() alternative, so
  // the declaration survives the strip. Reporting "removed DOCTYPE" here would
  // certify a fix that never happened.
  const svg = `<!DOCTYPE svg [\n${VALID_SVG}`;
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /DOCTYPE declaration that could not be removed automatically/,
  );
  assert.doesNotMatch(result.fixed.join('\n'), /removed DOCTYPE/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix adds a viewBox derived from width and height', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>';
  const result = runFix(svg);
  assertValidAssets(result);
  assert.match(result.files[ASSET], /<svg viewBox="0 0 640 480"/);
  assert.match(result.fixed.join('\n'), /added viewBox="0 0 640 480"/);
});

test('--fix parses fractional and unit-suffixed dimensions for the viewBox', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width = "640.5px" height = "480px"><rect/></svg>';
  const result = runFix(svg);
  assertValidAssets(result);
  assert.match(result.files[ASSET], /viewBox="0 0 640\.5 480"/);
});

test('--fix cannot repair a missing viewBox without dimensions', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /missing viewBox attribute and resolvable/,
  );
  assert.equal(result.files[ASSET], svg);
});

test('--fix requires both dimensions before deriving a viewBox', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100"/>';
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /missing viewBox attribute and resolvable width\/height/,
  );
  assert.equal(result.files[ASSET], svg);
  assert.deepEqual(result.fixed, []);
});

test('--fix strips draw.io mxfile metadata that would otherwise warn', () => {
  const svg = VALID_SVG.replace(
    '<svg ',
    '<svg content = "&lt;mxfile host=&quot;app&quot;&gt;" ',
  );
  const result = runFix(svg);
  assertValidAssets(result);
  assert.doesNotMatch(result.files[ASSET], /mxfile/);
  assert.doesNotMatch(assetDiagnostics(result), /mxfile/);
  assert.match(result.fixed.join('\n'), /stripped draw\.io mxfile metadata/);
});

// The mxfile strip deletes text, and deleting text can join two fragments that
// were inert while separated. The scans run before that edit, so the bytes
// written have to be re-checked or an auto-fix publishes a live script.
test('--fix refuses to write an mxfile strip that splices a <script> together', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<sc content="&lt;mxfile host=x"ript>alert(1)</script><animate/></svg>';
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.deepEqual(
    result.issues.find(({ message }) =>
      message.startsWith('auto-fix produced active content:'),
    ),
    {
      path: ASSET,
      severity: 'error',
      message:
        'auto-fix produced active content: contains a disallowed element <script>; contains a disallowed element <animate>',
    },
  );
  assert.equal(result.files[ASSET], svg);
});

test('--fix does not suppress a missing xmlns, and leaves the file alone', () => {
  const svg = '<svg viewBox="0 0 100 100"><rect/></svg>';
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /missing xmlns/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix does not suppress embedded raster data', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<image href="data:image/png;base64,AAAA"/>',
  );
  const result = runFix(svg);
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /embedded raster image data/);
  assert.equal(result.files[ASSET], svg);
});

test('--fix repairs several findings in one file and reports each', () => {
  const svg =
    '<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect/></svg>';
  const result = runFix(svg);
  assertValidAssets(result);
  assert.equal(result.fixed.length, 2);
  assert.doesNotMatch(result.files[ASSET], /DOCTYPE/);
  assert.match(result.files[ASSET], /viewBox="0 0 10 20"/);
});

test('--fix writes a repair to each asset it walks', () => {
  const second = 'static/img/architectures/nested/deep/two.svg';
  const result = validateAssetFixtures(
    {
      ...svgFixture(`<!DOCTYPE svg>\n${VALID_SVG}`),
      [second]: `<!DOCTYPE svg>\n${VALID_SVG}`,
    },
    { fix: true, readBack: [ASSET, second] },
  );
  assertValidAssets(result);
  assert.equal(result.fixed.length, 2);
  assert.equal(result.files[ASSET], VALID_SVG);
  assert.equal(result.files[second], VALID_SVG);
});

test('--fix ignores non-SVG assets', () => {
  const png = 'static/img/architectures/example/shot.png';
  const result = validateAssetFixtures(
    { [png]: 'not really a png' },
    { fix: true, readBack: [png] },
  );
  assertValidAssets(result);
  assert.equal(result.files[png], 'not really a png');
  assert.equal(result.assetCount, 1);
});

test('rejects a symlink among published assets', () => {
  const result = validateAssetFixtures(svgFixture(VALID_SVG), {
    symlinks: {
      'static/img/architectures/example/link.svg': 'diagram.svg',
    },
  });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /link\.svg.*symbolic link/);
});

test('validates mirrored cncf-projects assets with the same gate', () => {
  const result = validateAssetFixtures({
    'static/img/cncf-projects/helm-helm-icon-color.svg': VALID_SVG,
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 1);
});

test('rejects a non-image file in cncf-projects', () => {
  const result = validateAssetFixtures({
    'static/img/cncf-projects/helm-page.html': '<script>alert(1)</script>',
  });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /\.html is not an allowed asset type/);
});

test('rejects active content in a mirrored cncf-projects SVG', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>';
  const result = validateAssetFixtures({
    'static/img/cncf-projects/evil-icon.svg': svg,
  });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /active content/);
});

test('does not apply diagram-quality checks to mirrored artwork', () => {
  // Missing viewBox and embedded raster data are quality gates for
  // architecture diagrams only; upstream artwork ships both today.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,AAAA"/></svg>';
  const result = validateAssetFixtures({
    'static/img/cncf-projects/raster-icon.svg': svg,
  });
  assertValidAssets(result);
});

test('keeps diagram-quality checks off awards, members, favicons and root artwork', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>';
  const result = validateAssetFixtures(
    Object.fromEntries(
      [
        'static/img/awards/logo.svg',
        'static/img/end-user-members/logo.svg',
        'static/favicons/logo.svg',
        'static/logo.svg',
      ].map((path) => [path, svg]),
    ),
  );
  assert.deepEqual(result.issues, []);
});

test('--fix writes a repaired mirrored asset back to disk', () => {
  // Mirrored artwork returns early before the diagram-quality checks, so it
  // has its own write-back. Without it a security/structure repair made above
  // that branch would be reported as fixed but never persisted.
  const icon = 'static/img/cncf-projects/helm-helm-icon-color.svg';
  const svg = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">\n${VALID_SVG}`;
  const result = validateAssetFixtures(
    { [icon]: svg },
    { fix: true, readBack: [icon] },
  );
  assertValidAssets(result);
  assert.equal(result.files[icon], VALID_SVG);
  assert.doesNotMatch(result.files[icon], /DOCTYPE/);
  assert.match(result.fixed.join('\n'), /removed DOCTYPE/);
});

test('--fix fails closed on a mirrored-asset DOCTYPE it cannot remove', () => {
  // Mirrored artwork is written at an early return with no post-strip rescan,
  // so an unverified "removed DOCTYPE" on this path would publish the bytes
  // with no later gate catching the surviving declaration.
  const icon = 'static/img/cncf-projects/helm-helm-icon-color.svg';
  const svg = `<!DOCTYPE svg [\n${VALID_SVG}`;
  const result = validateAssetFixtures(
    { [icon]: svg },
    { fix: true, readBack: [icon] },
  );
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /DOCTYPE declaration that could not be removed automatically/,
  );
  assert.equal(result.files[icon], svg);
});

test('warns on an asset larger than 2 MB but still passes', () => {
  // The size gate is advisory: oversized diagrams slow the site down but are
  // not a correctness failure, so the run must warn and still exit 0.
  const padding = ' '.repeat(2 * 1024 * 1024);
  const svg = VALID_SVG.replace('<svg ', `<svg data-pad="${padding}" `);
  const result = validateAssetFixtures(svgFixture(svg, 'large.svg'));
  assertValidAssets(result);
  assert.match(assetDiagnostics(result), /large\.svg: asset is \d+\.\d\d MB/);
  assert.deepEqual(result.issues, [
    {
      path: 'static/img/architectures/example/large.svg',
      severity: 'warn',
      message: 'asset is 2.00 MB (consider optimization)',
    },
  ]);
  assert.equal(result.assetCount, 1);
});

test('does not warn on an asset exactly at the 2 MB limit', () => {
  const result = validateAssetFixtures({
    'static/img/architectures/example/limit.png': Buffer.alloc(2 * 1024 * 1024),
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.assetCount, 1);
});

// static/img and static/favicons hold site chrome — the footer logo, the
// favicon set — rather than imported assets. They are served from the same
// origin as the diagrams, so a browser that opens one of their SVGs directly
// executes any script it carries, so they are inside the gate too.

test('rejects active content in a site-chrome SVG under static/img', () => {
  const logo = 'static/img/cncf_logo_white.svg';
  const svg = VALID_SVG.replace('<rect', '<script>alert(1)</script><rect');
  const result = validateAssetFixtures({ [logo]: svg });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /cncf_logo_white\.svg: active content/,
  );
});

test('rejects active content in a favicon SVG under static/favicons', () => {
  const icon = 'static/favicons/favicon.svg';
  const svg = VALID_SVG.replace(
    '<rect',
    '<a xlink:href="javascript:alert(1)"/><rect',
  );
  const result = validateAssetFixtures({ [icon]: svg });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /favicon\.svg: active content/);
});

test('rejects a remote resource reference in a site-chrome SVG', () => {
  // Executes nothing, so the active-content gate does not see it, but the
  // browser still fetches it from the third-party host on every page view.
  const logo = 'static/img/cncf_logo_white.svg';
  const svg = VALID_SVG.replace(
    '<rect',
    '<image href="https://evil.example/beacon.png"/><rect',
  );
  const result = validateAssetFixtures({ [logo]: svg });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /cncf_logo_white\.svg: remote reference/,
  );
  assert.match(assetDiagnostics(result), /evil\.example/);
});

test('rejects a non-image file in static/img', () => {
  const result = validateAssetFixtures({
    'static/img/page.html': '<html>x</html>',
  });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /\.html is not an allowed asset type/);
});

test('accepts the legacy favicon.ico that static/img serves', () => {
  // ICO is a raster container no browser parses as markup, so it is safe at
  // the origin even though the importer never mirrors one.
  const result = validateAssetFixtures({
    'static/img/favicon.ico': 'not-really-an-icon',
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 1);
});

test('walks static/img shallowly so diagram-quality checks stay scoped', () => {
  // static/img is walked without recursion because its image subdirectories
  // are gated as their own roots. A viewBox-less logo sitting directly in
  // static/img must therefore pass, while the same file under
  // static/img/architectures fails the diagram-quality gate.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const chrome = validateAssetFixtures({ 'static/img/logo.svg': svg });
  assertValidAssets(chrome);

  const diagram = validateAssetFixtures(svgFixture(svg));
  assertInvalidAssets(diagram);
  assert.match(assetDiagnostics(diagram), /missing viewBox/);
});

test('reports a symlinked directory sitting directly in static/img', () => {
  // The shallow walk must still reject symlinks: the symlink check runs
  // before the directory branch, so a link that would otherwise be skipped
  // for not being recursed into is still a finding.
  const result = validateAssetFixtures(
    { 'static/img/architectures/example/diagram.svg': VALID_SVG },
    { symlinks: { 'static/img/elsewhere': 'architectures/example' } },
  );
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /elsewhere: is a symbolic link/);
});

// Dynamic static/ directory discovery — a new top-level static/ subdirectory
// must be either gated (assetDirs) or explicitly exempted, so it cannot reach
// the site origin with no CI signal.

test('rejects a new static/ subdirectory that is neither gated nor exempted', () => {
  const result = validateAssetFixtures({
    'static/uploads/whatever.svg': VALID_SVG,
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/uploads: is a static\/ subdirectory not covered by the asset security gate; add it to assetDirs or exemptTopLevelDirs in scripts\/validate-architecture-assets\.mjs/,
  );
});

test('accepts a font file in the exempted static/fonts directory', () => {
  const result = validateAssetFixtures({
    'static/fonts/some-font.ttf': 'not really a font',
    'static/fonts/some-font.woff': 'not really a font',
    'static/fonts/some-font.woff2': 'not really a font',
    'static/img/architectures/example/diagram.svg': VALID_SVG,
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 1);
});

// An exemption narrows the gate to the font allow-list; it does not remove it.
// static/fonts is published at the site origin like every other static/
// directory, so a file the browser executes as markup must not reach it.

test('rejects a script-bearing SVG hidden in the exempted static/fonts directory', () => {
  const result = validateAssetFixtures({
    'static/fonts/poc.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'static/img/architectures/example/diagram.svg': VALID_SVG,
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/fonts\/poc\.svg: \.svg is not an allowed asset type/,
  );
});

test('rejects an HTML file in the exempted static/fonts directory', () => {
  const result = validateAssetFixtures({
    'static/fonts/poc.html': '<html><script>alert(1)</script></html>',
    'static/img/architectures/example/diagram.svg': VALID_SVG,
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/fonts\/poc\.html: \.html is not an allowed asset type/,
  );
});

test('rejects a symlink inside the exempted static/fonts directory', () => {
  const result = validateAssetFixtures(
    {
      'static/fonts/some-font.woff2': 'not really a font',
      'static/img/architectures/example/diagram.svg': VALID_SVG,
    },
    { symlinks: { 'static/fonts/link.woff': 'some-font.woff2' } },
  );
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/fonts\/link\.woff: is a symbolic link/,
  );
});

test('gates a nested subdirectory of the exempted static/fonts directory', () => {
  const result = validateAssetFixtures({
    'static/fonts/nested/poc.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'static/img/architectures/example/diagram.svg': VALID_SVG,
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/fonts\/nested\/poc\.svg: \.svg is not an allowed asset type/,
  );
});

test('rejects a symlink standing in for a top-level static/ directory', () => {
  const result = validateAssetFixtures(
    { 'static/img/architectures/example/diagram.svg': VALID_SVG },
    { symlinks: { 'static/uploads': 'img' } },
  );
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /static\/uploads: is a symbolic link/);
});

test('does not flag static/ subdirectories the gate already walks', () => {
  const result = validateAssetFixtures({
    'static/img/architectures/example/diagram.svg': VALID_SVG,
    'static/favicons/favicon.svg': VALID_SVG,
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 2);
});

// Dynamic static/ file discovery — a file sitting directly in static/ has no
// enclosing directory for assetDirs to gate, but it is served from the site
// origin exactly like one inside a gated subdirectory.

test('rejects a markup file sitting directly in static/', () => {
  const result = validateAssetFixtures({
    'static/pwn.html': '<html><script>alert(1)</script></html>',
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/pwn\.html: \.html is not an allowed asset type/,
  );
});

test('scans an SVG sitting directly in static/ for active content', () => {
  const result = validateAssetFixtures({
    'static/pwn.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>',
  });
  assertInvalidAssets(result);
  assert.match(assetDiagnostics(result), /static\/pwn\.svg: active content/);
});

test('accepts the exempted non-asset files in the static/ root', () => {
  const result = validateAssetFixtures({
    'static/manifest.json': '{"name":"site"}',
    'static/robots.txt': 'User-agent: *',
    'static/img/architectures/example/diagram.svg': VALID_SVG,
  });
  assertValidAssets(result);
});

test('accepts an allowed image sitting directly in static/', () => {
  const result = validateAssetFixtures({
    'static/logo.svg': VALID_SVG,
  });
  assertValidAssets(result);
});

// A static/ entry that is neither a symlink, a directory, nor a regular file
// — a FIFO, a socket, a device node — falls past all three guards in
// checkForUngatedStaticEntries. The gate skips it deliberately: there is no
// file content to hold to the extension allow-list, and handing the path to
// validateAsset would block the run forever on a readFileSync of a FIFO with
// no writer. Nothing pinned that, so a future guard reordering could turn the
// skip into a hang or a spurious error with the suite still green.
//
// mkfifo is the only portable way to make such an entry; the test is skipped
// where coreutils is absent rather than branching inside the test body, which
// would leave a permanently uncovered region behind.
const MKFIFO_MISSING = spawnSync('mkfifo', ['--version']).status !== 0;

test(
  'skips a static/ entry that is not a regular file',
  { skip: MKFIFO_MISSING },
  () => {
    const fixtures = {
      'static/img/architectures/example/diagram.svg': VALID_SVG,
    };
    const setup = (work) => {
      const fifo = join(work, 'static', 'pipe');
      assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    };
    const result = validateAssetFixtures(fixtures, { setup });
    assertValidAssets(result);
    assert.equal(result.assetCount, 1);
    assert.doesNotMatch(assetDiagnostics(result), /pipe/);
    const cli = runScriptWithFixtures(SCRIPT, fixtures, { setup });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'Validated 1 architecture asset(s).\n');
    assert.doesNotMatch(cli.stderr, /pipe/);
  },
);

test('rejects a subdirectory of the shallow static/img walk', () => {
  // static/img is walked with recurse: false because it holds site chrome
  // sitting directly in the directory. A shallow walk covers only those
  // files, so every subdirectory below it must be an asset root with its own
  // assetDirs entry; one that is not would otherwise ship to the site origin
  // with no gate at all.
  const result = validateAssetFixtures({
    'static/img/architectures/example/diagram.svg': VALID_SVG,
    'static/img/illustrations/nested.svg': '<svg><rect/></svg>',
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/img\/illustrations: is a subdirectory of a shallowly walked asset directory and is not covered by the asset security gate; add it to assetDirs in scripts\/validate-architecture-assets\.mjs/,
  );
});

test('rejects markup in a subdirectory of the shallow static/img walk', () => {
  // The extension allow-list is the only thing that keeps a .html off the
  // site origin, and it never ran below static/img: the file was published
  // verbatim with the validator, the unit suite and the build all green.
  const result = validateAssetFixtures({
    'static/img/architectures/example/diagram.svg': VALID_SVG,
    'static/img/blog/pwn.html': '<html><script>alert(1)</script></html>',
  });
  assertInvalidAssets(result);
  assert.match(
    assetDiagnostics(result),
    /static\/img\/blog: is a subdirectory/,
  );
});

test('does not flag the static/img subdirectories that are asset roots', () => {
  // The three real subdirectories each have their own assetDirs entry, so
  // they are returned by assetRootPaths before the new subdirectory check.
  const result = validateAssetFixtures({
    'static/img/architectures/example/diagram.svg': VALID_SVG,
    'static/img/cncf-projects/helm-helm-icon-color.svg': VALID_SVG,
    'static/img/awards/example.svg': VALID_SVG,
    'static/img/cncf_logo_white.svg': VALID_SVG,
  });
  assertValidAssets(result);
  assert.equal(result.assetCount, 4);
});

test('cli: reports successful asset validation', () => {
  const result = runScriptWithFixtures(SCRIPT, svgFixture(VALID_SVG));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Validated 1 architecture asset(s).\n');
  assert.equal(result.stderr, '');
});

test('cli: reports validation errors and exits unsuccessfully', () => {
  const result = runScriptWithFixtures(SCRIPT, {
    'static/img/architectures/example/notes.html': '<html/>',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.html is not an allowed asset type/);
  assert.doesNotMatch(result.stdout, /Validated/);
});

test('cli: missing asset directories validate as an empty tree', () => {
  const result = runScriptWithFixtures(SCRIPT, {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Validated 0 architecture asset(s).\n');
  assert.equal(result.stderr, '');
});

test('cli: malformed SVG remains a validation failure', () => {
  const malformed = VALID_SVG.replace('</svg>', '<g></svg>');
  const result = runScriptWithFixtures(SCRIPT, svgFixture(malformed));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected close tag/);
});

test('cli: --fix retains repair messages and the validation summary', () => {
  const result = runScriptWithFixtures(
    SCRIPT,
    svgFixture(`<!DOCTYPE svg>\n${VALID_SVG}`),
    { args: ['--fix'], readBack: [ASSET] },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    'Fixed 1 issue(s):\n' +
      '  - static/img/architectures/example/diagram.svg: removed DOCTYPE\n' +
      'Validated 1 architecture asset(s).\n' +
      'No fixes were needed.\n',
  );
  assert.equal(result.files[ASSET], VALID_SVG);
});

test('cli: --fix without changes reports that no fixes were needed', () => {
  const result = runScriptWithFixtures(SCRIPT, svgFixture(VALID_SVG), {
    args: ['--fix'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    'Validated 1 architecture asset(s).\nNo fixes were needed.\n',
  );
});

test('cli: warnings remain nonfatal and do not claim a clean --fix run', () => {
  const svg = VALID_SVG.replace(
    '<rect width="100" height="100"/>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>',
  );
  const result = runScriptWithFixtures(SCRIPT, svgFixture(svg), {
    args: ['--fix'],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /contains foreignObject/);
  assert.equal(result.stdout, 'Validated 1 architecture asset(s).\n');
});
