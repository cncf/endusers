import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findActiveContent } from '../scripts/lib/svg-active-content.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = join(repoRoot, 'static');

// scripts/validate-architecture-assets.mjs gates the SVGs it knows about, but
// it runs only inside the daily import workflow and only over the directories
// listed in its assetDirs. Neither limit is a property of the risk: every file
// under static/ is published verbatim at the site origin, and a browser that
// opens one directly executes any script it carries.
//
// This test walks static/ as a whole so the invariant is enforced by directory
// contents rather than by a hand-maintained list, and it runs under
// `npm run test:unit` -- which CI runs on every pull request -- so an SVG that
// carries active content is rejected at review time instead of after merge.
function svgFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // A symlink is never followed: its target may sit outside static/ and is
    // not what gets published.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) svgFiles(full, found);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
      found.push(full);
    }
  }
  return found;
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
