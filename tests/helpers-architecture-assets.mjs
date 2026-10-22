import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateArchitectureAssets } from '../scripts/lib/validate-architecture-assets.mjs';

export function validateAssetFixtures(
  fixtures,
  { fix, readBack = [], symlinks = {}, setup } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'endusers-assets-core-'));
  try {
    for (const [path, content] of Object.entries(fixtures)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    for (const [path, target] of Object.entries(symlinks)) {
      const link = join(root, path);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
    }
    if (setup) setup(root);
    const result = validateArchitectureAssets(root, fix);
    const mtimes = {};
    const files = Object.fromEntries(
      readBack.map((path) => {
        const target = join(root, path);
        mtimes[path] = statSync(target).mtimeMs;
        return [path, readFileSync(target, 'utf8')];
      }),
    );
    return { ...result, files, mtimes };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function assetDiagnostics({ issues }) {
  return issues.map(({ path, message }) => `${path}: ${message}`).join('\n');
}

export function assertValidAssets(result) {
  assert.equal(
    result.issues.some(({ severity }) => severity === 'error'),
    false,
    assetDiagnostics(result),
  );
}

export function assertInvalidAssets(result) {
  assert.equal(
    result.issues.some(({ severity }) => severity === 'error'),
    true,
    assetDiagnostics(result),
  );
}
