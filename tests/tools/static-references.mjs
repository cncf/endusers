// The static-asset contract in tests/static-assets.test.mjs is only as good as
// its ability to spot a broken reference. Keeping the scan and the checkers
// here, parameterised by root, lets tests/static-references.test.mjs point them
// at a fixture tree that really does contain a missing, zero-byte,
// case-mismatched, escaping or unresolvable reference and confirm each one is
// reported.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export function walk(dir, extensions, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extensions, found);
    else if (extensions.some((ext) => entry.name.endsWith(ext)))
      found.push(full);
  }
  return found;
}

// Absolute and protocol-relative URLs contain path segments that look exactly
// like local references (".../main/images/foo.jpg"). Remove them before
// scanning so a remote URL is never mistaken for a missing local asset.
export function stripUrls(text) {
  return text
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`)\]<>]*/g, ' ')
    .replace(/(^|[\s"'`(=])\/\/[^\s"'`)\]<>]*/g, ' ');
}

const PATH_TOKEN = /\/[A-Za-z0-9._%-]+(?:\/[A-Za-z0-9._%~-]+)*/g;

function sourceFiles({ repoRoot, sources, dataFiles }) {
  const files = [];
  for (const { dir, extensions } of sources) {
    files.push(...walk(join(repoRoot, dir), extensions));
  }
  for (const name of dataFiles) files.push(join(repoRoot, name));
  return files;
}

// Top-level names under static/ are the only absolute paths that resolve to a
// file on disk. Everything else beginning with "/" is a page route, which
// Docusaurus already enforces via onBrokenLinks: 'throw'.
function staticReferences(file, { repoRoot, staticRoot, staticTopLevel }) {
  const text = stripUrls(readFileSync(file, 'utf8'));
  const refs = new Map();
  for (const match of text.match(PATH_TOKEN) || []) {
    const ref = match.replace(/[.]+$/, '');
    const [, first] = ref.split('/');
    if (!staticTopLevel.has(first)) continue;
    // A bare "/img" with no file after it is not an asset reference.
    if (ref === `/${first}` && statSync(join(staticRoot, first)).isDirectory())
      continue;
    if (!refs.has(ref)) refs.set(ref, relative(repoRoot, file));
  }
  return refs;
}

export function collectReferences({
  repoRoot,
  staticRoot,
  sources,
  dataFiles,
}) {
  const staticTopLevel = new Set(readdirSync(staticRoot));
  const all = new Map();
  for (const file of sourceFiles({ repoRoot, sources, dataFiles })) {
    const found = staticReferences(file, {
      repoRoot,
      staticRoot,
      staticTopLevel,
    });
    for (const [ref, origin] of found) {
      if (!all.has(ref)) all.set(ref, []);
      all.get(ref).push(origin);
    }
  }
  return all;
}

export function describeRef(references, ref) {
  return `${ref} (referenced by ${references.get(ref).join(', ')})`;
}

export function findMissingAssets(references, staticRoot) {
  const missing = [];
  for (const ref of references.keys()) {
    const target = join(staticRoot, decodeURIComponent(ref));
    try {
      if (!statSync(target).isFile())
        missing.push(`${describeRef(references, ref)} is not a file`);
    } catch {
      missing.push(describeRef(references, ref));
    }
  }
  return missing;
}

export function findEmptyAssets(references, staticRoot) {
  const empty = [];
  for (const ref of references.keys()) {
    const target = join(staticRoot, decodeURIComponent(ref));
    let stats;
    try {
      stats = statSync(target);
    } catch {
      continue; // absence is reported by findMissingAssets()
    }
    if (stats.isFile() && stats.size === 0)
      empty.push(describeRef(references, ref));
  }
  return empty;
}

// GitHub Pages serves from a case-sensitive filesystem. A reference whose case
// differs from the file on disk resolves locally on macOS and 404s in
// production, so statSync() alone is not enough.
export function findCaseMismatches(references, staticRoot) {
  const mismatched = [];
  for (const ref of references.keys()) {
    const segments = decodeURIComponent(ref).split('/').filter(Boolean);
    let dir = staticRoot;
    for (const segment of segments) {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        break;
      }
      if (!entries.includes(segment)) {
        const insensitive = entries.find(
          (entry) => entry.toLowerCase() === segment.toLowerCase(),
        );
        if (insensitive)
          mismatched.push(
            `${describeRef(references, ref)} — on disk as "${insensitive}"`,
          );
        break;
      }
      dir = join(dir, segment);
    }
  }
  return mismatched;
}

export function findEscapingReferences(references, staticRoot) {
  const escaping = [];
  for (const ref of references.keys()) {
    const target = resolve(staticRoot, `.${decodeURIComponent(ref)}`);
    if (target !== staticRoot && !target.startsWith(`${staticRoot}/`))
      escaping.push(describeRef(references, ref));
  }
  return escaping;
}

// <CNCFProjectCard logo="/img/cncf-projects/..."> is authored by hand in the
// architecture docs. The component renders the value straight into <img src>,
// so a typo produces a broken image with no build-time error.
export function collectCardLogos(docsDir, repoRoot) {
  const cardLogos = new Map();
  for (const file of walk(docsDir, ['.md', '.mdx'])) {
    const text = readFileSync(file, 'utf8');
    for (const [, value] of text.matchAll(/\blogo=["']([^"']+)["']/g)) {
      if (!value.startsWith('/')) continue;
      if (!cardLogos.has(value)) cardLogos.set(value, relative(repoRoot, file));
    }
  }
  return cardLogos;
}

export function findBrokenCardLogos(cardLogos, staticRoot) {
  const broken = [];
  for (const [value, origin] of cardLogos) {
    const target = join(staticRoot, decodeURIComponent(value));
    try {
      if (!statSync(target).isFile())
        broken.push(`${value} (${origin}) is not a file`);
    } catch {
      broken.push(`${value} (${origin})`);
    }
  }
  return broken;
}
