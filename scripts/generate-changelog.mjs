#!/usr/bin/env node
// Renders docs/resources/changelog.md from the repository's git history.
// Runs as part of every build (package.json `_build`); see
// scripts/lib/changelog.mjs for the mechanism and CONTRIBUTING.md for the
// decision record.

import { fileURLToPath } from 'node:url';

import { generateChangelog } from './lib/changelog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

console.log(`generate:changelog: ${generateChangelog(root)}`);
