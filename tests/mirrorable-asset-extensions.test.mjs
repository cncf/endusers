// `scripts/lib/asset-extensions.mjs` is the one allowlist deciding which
// upstream files this site will copy into `static/` and serve verbatim from
// its own origin. Its header says what that means -- a `.html`, `.xhtml`,
// `.js` or `.svgz` entry would execute in the site's origin -- and asks that
// the list be reviewed as a security boundary. Until now nothing enforced it:
// no test imported the module, and `svgz` appeared nowhere else in the
// repository, so the four denied extensions were documented and not gated.
//
// The coverage gates cannot see this. The module is a bare `const`, so
// importing any consumer marks it fully covered, and it reports 100% lines and
// regions while the rule it exists to express is unchecked. Widening the set
// is a one-word diff that no existing check would reject.
//
// Pinning the literal alone would be too weak in the same way
// `tests/content-security-contract.test.mjs` argues: a constant the callers
// stopped consulting still parses. So each denied extension is also pushed
// through the two mirror entry points that read the set at runtime, and the
// consumers are held to importing it rather than redeclaring a copy -- the
// arrangement this module replaced, where five independent lists were kept in
// step by convention.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MIRRORABLE_ASSET_EXTENSIONS } from '../scripts/lib/asset-extensions.mjs';
import { artworkMirrorName } from '../scripts/lib/project-assets.mjs';
import { mirrorLandscapeLogo } from '../scripts/lib/enduser-collector.mjs';
import { resolveRepoRoot } from './helpers.mjs';

const root = resolveRepoRoot(import.meta.url);

// The four the module header names, plus the neighbours a well-meaning
// addition reaches for next: `.htm` for `.html`, `.mjs`/`.cjs` for `.js`,
// `.xml` for `.xhtml`, and the two plugin formats browsers historically
// executed. Each is markup, script, or a container for them.
const EXECUTABLE_EXTENSIONS = [
  '.html',
  '.htm',
  '.xhtml',
  '.xml',
  '.js',
  '.mjs',
  '.cjs',
  '.svgz',
  '.wasm',
  '.swf',
];

test('the mirror allowlist admits no browser-executable extension', () => {
  for (const extension of EXECUTABLE_EXTENSIONS) {
    assert.equal(
      MIRRORABLE_ASSET_EXTENSIONS.has(extension),
      false,
      `${extension} is served from the site origin and would execute there; ` +
        'it must not be mirrorable',
    );
  }
});

// `.svg` is the one entry that is markup, and it is allowed deliberately:
// every mirrored SVG is re-scanned for active content by
// `scripts/lib/svg-active-content.mjs` before it ships. `.svgz` is the same
// markup gzipped, which that scanner cannot read, which is why the header
// separates them. Asserting the pair keeps a future reader from "fixing" the
// inconsistency in either direction.
test('svg is allowed because it is scanned; svgz is not, because it cannot be', () => {
  assert.equal(MIRRORABLE_ASSET_EXTENSIONS.has('.svg'), true);
  assert.equal(MIRRORABLE_ASSET_EXTENSIONS.has('.svgz'), false);
});

// Every consumer lowercases the extension it slices off a filename before
// looking it up. An entry that is mixed-case, missing its dot, or carrying
// stray whitespace therefore matches nothing: it reads as an allowed format
// but silently denies every file of that type. The failure is invisible at
// the call site, so it is caught here instead.
test('every entry has the shape the lookups require', () => {
  for (const extension of MIRRORABLE_ASSET_EXTENSIONS) {
    assert.equal(
      typeof extension,
      'string',
      `entry ${String(extension)} is not a string`,
    );
    assert.match(
      extension,
      /^\.[a-z0-9]+$/,
      `${extension} must be a lowercase, dot-prefixed extension with no ` +
        'whitespace or second dot, or the consumers\u2019 toLowerCase lookup ' +
        'will never match it',
    );
  }
  assert.ok(
    MIRRORABLE_ASSET_EXTENSIONS.size > 0,
    'an empty allowlist would deny every asset and pass every assertion above',
  );
});

// Proof the set is still wired to something. `artworkMirrorName` returns the
// mirrored filename for a cncf/artwork path and `null` when it refuses; a
// denied extension must take the refusing branch.
test('the artwork mirror refuses every executable extension', () => {
  for (const extension of EXECUTABLE_EXTENSIONS) {
    assert.equal(
      artworkMirrorName(`projects/example/icon/color/example${extension}`),
      null,
      `artworkMirrorName mirrored example${extension}`,
    );
  }
  assert.equal(
    artworkMirrorName('projects/example/icon/color/example.svg'),
    'example-example.svg',
    'an allowed extension must still mirror, or the assertions above pass ' +
      'against a function that refuses everything',
  );
});

// The landscape logo mirror reads the same set. It rejects before touching the
// filesystem, so no checkout is needed: an unmirrorable logo leaves the record
// in the snapshot with a warning and no local asset.
test('the landscape logo mirror refuses every executable extension', () => {
  for (const extension of EXECUTABLE_EXTENSIONS) {
    const result = mirrorLandscapeLogo({
      record: { name: 'Example', logoFilename: `example${extension}` },
      sourceRoot: join(root, 'does-not-exist'),
      destinationRoot: join(root, 'does-not-exist'),
    });
    assert.equal(
      result.localLogo,
      null,
      `mirrorLandscapeLogo mirrored example${extension}`,
    );
    assert.equal(
      typeof result.logoWarning,
      'string',
      `example${extension} produced no warning at all`,
    );
    assert.match(
      result.logoWarning,
      /unsupported or unsafe logo filename/,
      `example${extension} was not refused as an unsupported filename`,
    );
  }
});

// This module replaced five hand-synchronised copies of the list. A consumer
// that reintroduces its own literal drifts out of the boundary silently -- the tests above would still pass, against a set it no
// longer reads.
test('every consumer imports the allowlist instead of redeclaring it', () => {
  const consumers = [
    'scripts/lib/validate-architecture-assets.mjs',
    'scripts/validate-enduser-members.mjs',
    'scripts/lib/enduser-collector.mjs',
    'scripts/lib/project-assets.mjs',
  ];
  for (const relative of consumers) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.match(
      source,
      /import \{\s*MIRRORABLE_ASSET_EXTENSIONS[^}]*\}\s*from\s*'[^']*asset-extensions\.mjs'/,
      `${relative} must import MIRRORABLE_ASSET_EXTENSIONS from ` +
        'scripts/lib/asset-extensions.mjs',
    );
    assert.doesNotMatch(
      source,
      /'\.(jpe?g|png|webp|avif|gif)'[\s\S]{0,80}'\.(jpe?g|png|webp|avif|gif)'/,
      `${relative} appears to redeclare a local image-extension list; the ` +
        'allowlist lives in scripts/lib/asset-extensions.mjs',
    );
  }
});
