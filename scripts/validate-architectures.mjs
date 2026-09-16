#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportAndExit } from './lib/validate-utils.mjs';

const root = new URL('..', import.meta.url).pathname;
const catalogPath = join(root, 'data/architectures/catalog.json');
if (!existsSync(catalogPath)) throw new Error('Missing data/architectures/catalog.json; run npm run import:architectures');

const records = JSON.parse(readFileSync(catalogPath, 'utf8'));
const ids = new Set();
const errors = [];
for (const record of records) {
  if (!record.id || !record.title || !record.organization) errors.push({ path: record.id || '<unknown>', severity: 'error', message: 'missing id, title, or organization' });
  if (ids.has(record.id)) errors.push({ path: record.id, severity: 'error', message: 'duplicate id' });
  ids.add(record.id);
  for (const asset of record.assets ?? []) if (!existsSync(join(root, 'static', asset.replace(/^\//, '')))) errors.push({ path: record.id, severity: 'error', message: `missing asset ${asset}` });
}
reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
