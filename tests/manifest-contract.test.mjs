import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, posix } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');
const manifestPath = join(staticRoot, 'manifest.json');

const manifestSource = readFileSync(manifestPath, 'utf8');

// https://www.w3.org/TR/appmanifest/#display-member
const DISPLAY_MODES = new Set([
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser',
]);

const EXTENSION_FOR_TYPE = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Per the appmanifest spec, member URLs resolve against the manifest's own
// URL, so both "/favicons/x.svg" and "favicons/x.svg" are valid and both land
// under static/ here (the manifest sits at static/manifest.json). Only a
// scheme-bearing URL leaves the site, which is what this rejects.
function hasScheme(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//');
}

// Docusaurus copies static/ into build/ verbatim, and GitHub Pages serves from
// a case-sensitive filesystem. existsSync() on a case-insensitive development
// machine happily resolves /favicons/Favicon.svg, so each segment is compared
// against the real directory entry instead.
function resolveCaseExact(reference) {
  const segments = reference.replace(/^\//, '').split('/').filter(Boolean);
  let current = staticRoot;
  for (const segment of segments) {
    const entries = readdirSync(current);
    assert.ok(
      entries.includes(segment),
      `${reference}: "${segment}" is not present in static/${posix.relative(
        staticRoot,
        current,
      )} case-exactly. Directory holds: ${entries.join(', ')}`,
    );
    current = join(current, segment);
  }
  return current;
}

function pngDimensions(buffer) {
  assert.equal(
    buffer.subarray(1, 4).toString('latin1'),
    'PNG',
    'expected a PNG signature',
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Parsed lazily and defensively: a syntax error must surface as a failure of
// the named test below rather than as a module-load crash that reports every
// other assertion in this file as "not run".
let parseError = null;
let manifest = {};
try {
  manifest = JSON.parse(manifestSource);
} catch (error) {
  parseError = error;
}

test('manifest.json parses as a JSON object', () => {
  assert.equal(
    parseError,
    null,
    `static/manifest.json must be valid JSON; a browser that cannot parse it drops the whole manifest silently: ${parseError?.message}`,
  );
  assert.equal(typeof manifest, 'object');
  assert.ok(manifest !== null && !Array.isArray(manifest));
});

test('manifest declares the fields browsers need to offer installation', () => {
  for (const field of ['name', 'short_name', 'start_url', 'display']) {
    assert.equal(typeof manifest[field], 'string', `${field} must be a string`);
    assert.ok(manifest[field].length > 0, `${field} must not be empty`);
  }
  assert.ok(
    DISPLAY_MODES.has(manifest.display),
    `display must be one of ${[...DISPLAY_MODES].join(', ')}, got ${manifest.display}`,
  );
  assert.ok(
    !hasScheme(manifest.start_url),
    'start_url must stay same-origin; an absolute URL points the installed app off-site',
  );
});

test('manifest declares icons, so the assertions below cannot be vacuous', () => {
  assert.ok(Array.isArray(manifest.icons), 'icons must be an array');
  assert.ok(
    manifest.icons.length > 0,
    'icons must be non-empty; an empty array makes the site non-installable',
  );
});

test('every icon entry is fully described', () => {
  for (const icon of manifest.icons) {
    assert.equal(typeof icon.src, 'string', 'icon.src must be a string');
    assert.ok(
      !hasScheme(icon.src),
      `${icon.src} must be a same-origin path, not an absolute URL`,
    );
    assert.ok(
      !icon.src.split('/').includes('..'),
      `${icon.src} must not escape static/`,
    );
    assert.equal(
      typeof icon.sizes,
      'string',
      `${icon.src}: sizes must be a string`,
    );
    assert.equal(
      typeof icon.type,
      'string',
      `${icon.src}: type must be a string`,
    );
    assert.ok(
      Object.hasOwn(EXTENSION_FOR_TYPE, icon.type),
      `${icon.src}: unrecognised type ${icon.type}`,
    );
  }
});

test('every icon resolves under static/ case-exactly and is non-empty', () => {
  for (const icon of manifest.icons) {
    const resolved = resolveCaseExact(icon.src);
    const stats = statSync(resolved);
    assert.ok(stats.isFile(), `${icon.src} must resolve to a file`);
    assert.ok(
      stats.size > 0,
      `${icon.src} is zero bytes; browsers treat it as a missing icon`,
    );
  }
});

test('each icon file matches the media type it is declared with', () => {
  for (const icon of manifest.icons) {
    const resolved = resolveCaseExact(icon.src);
    assert.ok(
      resolved.endsWith(EXTENSION_FOR_TYPE[icon.type]),
      `${icon.src} is declared ${icon.type} but does not end in ${EXTENSION_FOR_TYPE[icon.type]}`,
    );
  }
});

test('raster icon dimensions match their declared sizes', () => {
  for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
    assert.match(
      icon.sizes,
      /^\d+x\d+$/,
      `${icon.src}: a raster icon needs concrete pixel sizes, got ${icon.sizes}`,
    );
    const [width, height] = icon.sizes.split('x').map(Number);
    const actual = pngDimensions(readFileSync(resolveCaseExact(icon.src)));
    assert.deepEqual(
      actual,
      { width, height },
      `${icon.src} is ${actual.width}x${actual.height} on disk but declared ${icon.sizes}`,
    );
  }
});

test('vector icons declare sizes "any" rather than fixed pixels', () => {
  for (const icon of manifest.icons.filter((i) => i.type === 'image/svg+xml')) {
    assert.equal(
      icon.sizes,
      'any',
      `${icon.src} is scalable, so pinning it to ${icon.sizes} hides it from every other size bucket`,
    );
  }
});

// Chromium requires a >=192px and a >=512px icon before it will fire
// beforeinstallprompt. Losing either one removes the install affordance with
// no build-time or runtime error.
test('manifest carries icons large enough for an install prompt', () => {
  const pixelSizes = manifest.icons
    .filter((icon) => /^\d+x\d+$/.test(icon.sizes))
    .map((icon) => Number(icon.sizes.split('x')[0]));
  assert.ok(
    pixelSizes.some((size) => size >= 192),
    `needs an icon of at least 192px, have: ${pixelSizes.join(', ') || 'none'}`,
  );
  assert.ok(
    pixelSizes.some((size) => size >= 512),
    `needs an icon of at least 512px, have: ${pixelSizes.join(', ') || 'none'}`,
  );
});

test('theme and background colors are six-digit hex', () => {
  for (const field of ['background_color', 'theme_color']) {
    if (manifest[field] === undefined) continue;
    assert.match(
      manifest[field],
      HEX_COLOR,
      `${field} must be a #rrggbb value; shorthand and named colors are unevenly supported`,
    );
  }
});

test('no two icons claim the same src', () => {
  const sources = manifest.icons.map((icon) => icon.src);
  assert.deepEqual(
    sources,
    [...new Set(sources)],
    'duplicate icon src entries mean one of them is dead weight',
  );
});
