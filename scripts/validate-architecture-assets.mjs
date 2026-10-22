#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { validateArchitectureAssets } from './lib/validate-architecture-assets.mjs';
import { reportAndExit } from './lib/validate-utils.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shouldFix = process.argv.includes('--fix');
const { issues, fixed, assetCount } = validateArchitectureAssets(
  root,
  shouldFix,
);

if (fixed.length) {
  console.log(`Fixed ${fixed.length} issue(s):`);
  for (const message of fixed) console.log(`  - ${message}`);
}

reportAndExit(issues, 'architecture assets');

console.log(`Validated ${assetCount} architecture asset(s).`);
if (shouldFix && issues.length === 0) {
  console.log('No fixes were needed.');
}
