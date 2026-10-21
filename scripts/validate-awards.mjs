#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateAwards } from './lib/validate-awards.mjs';
import { reportAndExit } from './lib/validate-utils.mjs';

const staticRoot = fileURLToPath(new URL('../static/', import.meta.url));
const data = JSON.parse(
  readFileSync(new URL('../data/awards.json', import.meta.url)),
);
const errors = validateAwards(data, staticRoot);
reportAndExit(errors, 'awards');
console.log(`Validated ${data.awards.length} award entries`);
