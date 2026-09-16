#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportAndExit } from './lib/validate-utils.mjs';
import { findActiveContent } from './lib/mdx-active-content.mjs';

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
  if (record.id) {
    const docPath = join(root, 'docs/architectures', `${record.id}.md`);
    if (existsSync(docPath)) {
      for (const { line, reason, snippet } of findActiveContent(readFileSync(docPath, 'utf8')))
        errors.push({ path: `${record.id}.md:${line}`, severity: 'error', message: `active content in imported page (${reason}): ${snippet}` });
    }
  }
}
reportAndExit(errors, 'architecture catalog');
console.log(`Validated ${records.length} architecture records`);
