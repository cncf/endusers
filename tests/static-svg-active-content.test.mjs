import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findActiveContent,
  findRemoteReferences,
} from '../scripts/lib/svg-active-content.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');

// scripts/validate-architecture-assets.mjs gates the SVGs it knows about, but
// only over the directories listed in its assetDirs. That limit is not a
// property of the risk: every file under static/ is published verbatim at the
// site origin, and a browser that opens one directly executes any script it
// carries.
//
// This test walks static/ as a whole so the invariant is enforced by directory
// contents rather than by a hand-maintained list, and it runs under
// `npm run test:unit` -- which CI runs on every pull request -- so an SVG that
// carries active content is rejected at review time instead of after merge.
function walkStatic(dir, found = { files: [], symlinks: [] }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // A symlink is not followed, but it is not ignored either, because the
    // build dereferences it: @docusaurus/core's StaticDirectoriesCopyPlugin
    // copies static/ with copy-webpack-plugin, which globs through fast-glob
    // with followSymbolicLinks defaulting to true and then emits each match's
    // contents as an asset. A symlink here is therefore published as an
    // ordinary file holding its target's bytes -- even when that target sits
    // outside static/, or outside the repository entirely. Recording it as an
    // offender matches the rule validate-architecture-assets.mjs already
    // enforces ("is a symbolic link; symlinks are not allowed"), rather than
    // walking through to a target that is not the file review looked at.
    if (entry.isSymbolicLink()) {
      found.symlinks.push(full);
      continue;
    }
    if (entry.isDirectory()) walkStatic(full, found);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
      found.files.push(full);
    }
  }
  return found;
}

function svgFiles(dir) {
  return walkStatic(dir).files;
}

test('every SVG published from static/ is free of active content', () => {
  const offenders = [];
  for (const file of svgFiles(staticRoot)) {
    const findings = findActiveContent(readFileSync(file, 'utf8'));
    if (findings.length) {
      offenders.push(`${relative(repoRoot, file)}: ${findings.join('; ')}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `static/ is served at the site origin, so an SVG there executes in this origin when opened directly:\n${offenders.join('\n')}`,
  );
});

test('static/ actually contains SVGs, so the walk cannot pass vacuously', () => {
  assert.ok(
    svgFiles(staticRoot).length > 0,
    'found no SVGs under static/; the walk is no longer checking anything',
  );
});

test('no entry under static/ is a symlink, so the walk cannot be stepped around', () => {
  const symlinks = walkStatic(staticRoot).symlinks.map((file) =>
    relative(repoRoot, file),
  );

  assert.deepEqual(
    symlinks,
    [],
    `the build publishes a symlink as a regular file holding its target's bytes, so an SVG reached through one would be served from this origin without the active-content walk above ever reading it:\n${symlinks.join('\n')}`,
  );
});

// Same walk, second gate. A remote reference executes nothing, so
// findActiveContent does not report it, but every visitor who loads a page
// embedding the diagram still fetches it from the third-party host named in
// the file -- disclosing their IP address, User-Agent and Referer. Project
// artwork is mirrored to a local path for exactly this reason
// (scripts/lib/project-assets.mjs); the diagrams are held to it here.
test('no SVG published from static/ references a remote resource', () => {
  const offenders = [];
  for (const file of svgFiles(staticRoot)) {
    const findings = findRemoteReferences(readFileSync(file, 'utf8'));
    if (findings.length) {
      offenders.push(`${relative(repoRoot, file)}: ${findings.join('; ')}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `an SVG under static/ must not hot-link a third-party host; mirror the asset locally instead:\n${offenders.join('\n')}`,
  );
});
