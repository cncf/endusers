#!/usr/bin/env node
import {
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectError, reportAndExit } from './lib/validate-utils.mjs';
import {
  findActiveContent,
  findRemoteReferences,
} from './lib/svg-active-content.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// Mirrors MIRRORABLE_ASSET_EXTENSIONS in scripts/import-architectures.mjs.
// static/ is published verbatim at the site origin, so a file the browser
// executes as markup or script must never be present here.
const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

// static/img additionally serves the legacy favicon.ico. ICO is a raster
// container that no browser parses as markup or script, so it is safe at the
// origin. It stays out of ALLOWED_ASSET_EXTENSIONS because that set mirrors
// what the importer will mirror, and the importer never writes an .ico.
const SITE_CHROME_EXTENSIONS = new Set([...ALLOWED_ASSET_EXTENSIONS, '.ico']);

// Every directory here is published verbatim at the site origin, so every one
// gets the security gate (extension allow-list, symlink rejection, SVG active
// content). The gate is scoped by where the bytes are *served from*, not by
// where they came from: an award logo hand-committed in a pull request lands at
// the same origin as an imported diagram, and a browser that opens it directly
// executes any script it carries just the same.
//
// Diagram-quality checks (viewBox, raster bloat, editor metadata) apply only
// to architecture diagrams; mirrored cncf/artwork icons and award logos are
// kept byte-faithful apart from the security gate.
//
// static/img and static/favicons hold site chrome - the footer logo, the
// favicons - rather than imported assets, but they are served from the same
// origin as everything else, so they carry the same security gate. static/img
// is walked shallowly because its image subdirectories are listed above, each
// with its own quality setting; walk() rejects any *other* subdirectory it
// finds there, since a shallow walk would otherwise publish its contents with
// no gate at all.
//
// static/fonts is deliberately outside the gate (it holds no SVG, and its
// extensions are legitimately outside the image allow-list) via the
// exemptTopLevelDirs exemption below. Files sitting directly in the static/
// root have no enclosing directory for this list to gate, so
// checkForUngatedStaticEntries gates each one individually: the known non-asset
// files (robots.txt, manifest.json, .nojekyll) are named in exemptTopLevelFiles
// and every other one is held to the site-chrome extension allow-list.
const assetDirs = [
  { dir: join(root, 'static/img/architectures'), quality: true },
  { dir: join(root, 'static/img/cncf-projects'), quality: false },
  { dir: join(root, 'static/img/awards'), quality: false },
  {
    dir: join(root, 'static/img'),
    quality: false,
    recurse: false,
    extensions: SITE_CHROME_EXTENSIONS,
  },
  {
    dir: join(root, 'static/favicons'),
    quality: false,
    extensions: SITE_CHROME_EXTENSIONS,
  },
];
const shouldFix = process.argv.includes('--fix');

// Paths that are asset roots in their own right. The shallow static/img walk
// must not report on them whatever they turn out to be on disk: each one is
// already handled by its own entry above, which decides for itself whether a
// symlink is an error and whether a non-directory is skipped. Without this the
// shallow walk would duplicate the symlink error and would additionally reject
// a regular file sitting where a root is expected.
const assetRootPaths = new Set(assetDirs.map(({ dir }) => dir));

// Top-level static/ subdirectory names the gate above already walks, derived
// from assetDirs rather than hand-duplicated so the two can't drift.
const gatedTopLevelDirs = new Set(
  assetDirs.map(({ dir }) => relative(join(root, 'static'), dir).split('/')[0]),
);

// Top-level static/ subdirectories that are deliberately outside the gate,
// with the reason a reviewer needs to approve a new exemption. A directory
// reaching the site origin under neither this map nor assetDirs above is a
// silent gap: it ships whatever it contains — including a script-bearing SVG
// — with no CI signal.
const exemptTopLevelDirs = new Map([
  ['fonts', 'holds only font files (.woff/.woff2); never SVG or markup'],
]);

// Top-level static/ *files*, which have no enclosing directory for assetDirs to
// gate. static/foo.html is served from the site origin exactly like a file in a
// gated subdirectory, so it is held to the same extension allow-list; anything
// that is not an asset at all is named here with the reason a reviewer needs to
// approve a new exemption.
const exemptTopLevelFiles = new Map([
  ['.nojekyll', 'empty marker read by GitHub Pages; carries no content'],
  ['manifest.json', 'web app manifest; JSON data, never parsed as markup'],
  ['robots.txt', 'crawler directives; plain text, never parsed as markup'],
]);

const issues = [];
const fixed = [];

// Fails loudly on a static/ entry that is neither gated by assetDirs nor
// explicitly exempted above, so nothing newly published can reach the site
// origin unchecked. Mirrors assetRootKind(): a missing static/ is not an error
// (nothing is published), but a symlink standing in for a top-level entry is,
// for the same reason symlinked asset roots are.
function checkForUngatedStaticEntries() {
  const staticDir = join(root, 'static');
  const stats = lstatSync(staticDir, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory()) return;

  for (const entry of readdirSync(staticDir, { withFileTypes: true })) {
    const path = join(staticDir, entry.name);
    if (entry.isSymbolicLink()) {
      record(path, 'error', 'is a symbolic link; symlinks are not allowed');
      continue;
    }
    if (entry.isDirectory()) {
      if (gatedTopLevelDirs.has(entry.name)) continue;
      if (exemptTopLevelDirs.has(entry.name)) continue;
      record(
        path,
        'error',
        'is a static/ subdirectory not covered by the asset security gate; ' +
          'add it to assetDirs or exemptTopLevelDirs in ' +
          'scripts/validate-architecture-assets.mjs',
      );
      continue;
    }
    if (!entry.isFile()) continue;
    if (exemptTopLevelFiles.has(entry.name)) continue;
    // Site chrome is what a top-level file can legitimately be; the extension
    // allow-list inside validateAsset rejects anything the browser would run
    // as markup or script, and an SVG is additionally scanned for active
    // content.
    validateAsset(path, false, SITE_CHROME_EXTENSIONS);
  }
}

function walk(dir, recurse = true) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (assetRootPaths.has(path)) return [];
    // A symlink in published assets can point anywhere in the repository (or
    // outside it) and would be followed by readers and --fix writers, so its
    // presence is itself an error rather than something to validate through.
    // Checked before the directory branch, so a symlinked directory is still
    // reported in a shallow walk.
    if (entry.isSymbolicLink()) {
      record(path, 'error', 'is a symbolic link; symlinks are not allowed');
      return [];
    }
    if (entry.isDirectory()) {
      if (recurse) return walk(path);
      // A shallow walk covers only the files sitting directly in the
      // directory, so every subdirectory below it must be an asset root with
      // its own assetDirs entry (returned above via assetRootPaths). One that
      // is not is published at the site origin with no gate at all -- the same
      // silent gap checkForUngatedStaticEntries() closes at the static/ root,
      // one level down.
      record(
        path,
        'error',
        'is a subdirectory of a shallowly walked asset directory and is not ' +
          'covered by the asset security gate; add it to assetDirs in ' +
          'scripts/validate-architecture-assets.mjs',
      );
      return [];
    }
    return [path];
  });
}

function record(path, severity, message) {
  const rel = relative(root, path);
  collectError(issues, rel, severity, message);
}

function validateSvg(path, quality) {
  const original = readFileSync(path, 'utf8');
  let source = original;
  const rel = relative(root, path);

  // Critical: SVG must declare the SVG namespace.
  if (!/\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(source)) {
    record(path, 'error', 'missing xmlns="http://www.w3.org/2000/svg"');
  }

  // Critical: DOCTYPE is unnecessary in SVG images and can break XML parsers.
  if (/<!DOCTYPE\s/i.test(source)) {
    if (shouldFix) {
      source = source.replace(/<!DOCTYPE\s[^>]*>\s*/i, '');
      fixed.push(`${rel}: removed DOCTYPE`);
    } else {
      record(path, 'error', 'contains a DOCTYPE declaration');
    }
  }

  // Critical: SVGs are served from the site origin, so a browser that opens one
  // directly executes any script it carries. Never auto-fixed — active content
  // in an imported asset is a finding a human needs to see, not silent churn.
  for (const finding of findActiveContent(source)) {
    record(path, 'error', `active content: ${finding}`);
  }

  // Critical: a remote reference executes nothing, but the browser fetches it
  // from a host the upstream diagram author chose, disclosing the visitor's IP,
  // User-Agent and Referer. Project artwork is mirrored locally to prevent
  // exactly this; diagrams are held to the same standard. Never auto-fixed,
  // for the same reason as active content.
  for (const finding of findRemoteReferences(source)) {
    record(path, 'error', `remote reference: ${finding}`);
  }

  if (!quality) {
    if (shouldFix && source !== original) {
      writeFileSync(path, source, 'utf8');
    }
    return;
  }

  // Critical: viewBox is required for responsive rendering at all sizes.
  // Auto-fix when explicit width/height dimensions are present.
  if (!/\sviewBox\s*=\s*["']/.test(source)) {
    const widthMatch = source.match(/\swidth\s*=\s*["']([^"']+)["']/);
    const heightMatch = source.match(/\sheight\s*=\s*["']([^"']+)["']/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : NaN;
    const height = heightMatch ? parseFloat(heightMatch[1]) : NaN;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      if (shouldFix) {
        source = source.replace(
          /<svg\b/i,
          `<svg viewBox="0 0 ${width} ${height}"`,
        );
        fixed.push(`${rel}: added viewBox="0 0 ${width} ${height}"`);
      } else {
        record(
          path,
          'error',
          `missing viewBox attribute (has width=${width}, height=${height})`,
        );
      }
    } else {
      record(
        path,
        'error',
        'missing viewBox attribute and resolvable width/height',
      );
    }
  }

  // Critical: embedded raster data bloats SVGs and defeats the format's purpose.
  if (/data:image\/(jpeg|png|gif|bmp|webp)/i.test(source)) {
    record(path, 'error', 'contains embedded raster image data');
  }

  // Warning: draw.io/Excalidraw metadata bloats files and may confuse optimizers.
  if (/\scontent\s*=\s*["']&lt;mxfile/i.test(source)) {
    if (shouldFix) {
      source = source.replace(/\scontent\s*=\s*["'][^"']*["']/i, '');
      fixed.push(`${rel}: stripped draw.io mxfile metadata`);
    } else {
      record(
        path,
        'warn',
        'contains draw.io mxfile metadata in content attribute',
      );
    }
  }

  // Warning: foreignObject is not supported by all SVG renderers and can fall back poorly.
  if (/<foreignObject\b/i.test(source)) {
    record(
      path,
      'warn',
      'contains foreignObject (ensure a text fallback is present)',
    );
  }

  if (shouldFix && source !== original) {
    writeFileSync(path, source, 'utf8');
  }
}

function validateAsset(path, quality, extensions) {
  const rel = relative(root, path);
  const stats = statSync(path);
  const maxSize = 2 * 1024 * 1024; // 2 MB
  if (stats.size > maxSize) {
    record(
      path,
      'warn',
      `asset is ${(stats.size / 1024 / 1024).toFixed(2)} MB (consider optimization)`,
    );
  }

  const extension = extname(path).toLowerCase();
  if (!extensions.has(extension)) {
    record(
      path,
      'error',
      `${extension || 'extensionless file'} is not an allowed asset type; static/ is served at the site origin`,
    );
    return;
  }

  // Reuses the lowercased `extension` above rather than testing the raw path:
  // the allow-list already accepts `diagram.SVG` as an SVG, so a case-sensitive
  // test here would let that file skip validateSvg() entirely and reach the
  // site origin with no active-content or remote-reference scan at all.
  if (extension === '.svg') {
    validateSvg(path, quality);
  }
}

checkForUngatedStaticEntries();

const assets = assetDirs.flatMap(
  ({ dir, quality, recurse = true, extensions = ALLOWED_ASSET_EXTENSIONS }) => {
    const kind = assetRootKind(dir);
    // Fail loudly rather than skipping: a silently unvalidated asset root ships
    // unchecked SVGs from the site origin.
    if (kind === 'symlink') {
      record(
        dir,
        'error',
        'asset directory is a symbolic link; symlinks are not allowed',
      );
      return [];
    }
    if (kind !== 'directory') return [];
    return walk(dir, recurse).map((path) => ({ path, quality, extensions }));
  },
);
for (const { path, quality, extensions } of assets) {
  validateAsset(path, quality, extensions);
}

if (fixed.length) {
  console.log(`Fixed ${fixed.length} issue(s):`);
  for (const message of fixed) console.log(`  - ${message}`);
}

reportAndExit(issues, 'architecture assets');

// Reached only when there are no errors (warnings do not abort).
console.log(`Validated ${assets.length} architecture asset(s).`);
if (shouldFix && issues.length === 0) {
  console.log('No fixes were needed.');
}

// True only for a path that is itself a directory, never a symlink pointing at
// one. walk() rejects symlinked *entries*, but a walk rooted at a symlinked
// directory descends into the link target, so every file found there is
// validated as if it were a published asset and is written back through by
// --fix. Mirrors isRealDirectory() in scripts/import-architectures.mjs.
function assetRootKind(dir) {
  const stats = lstatSync(dir, { throwIfNoEntry: false });
  if (!stats) return 'missing';
  if (stats.isSymbolicLink()) return 'symlink';
  return stats.isDirectory() ? 'directory' : 'other';
}
