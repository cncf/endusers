#!/usr/bin/env node
// Regenerates the launch-metrics table in ROADMAP.md from
// data/launch-metrics.json, which is the actual source of truth (issue
// #100 review feedback: don't let a hand-maintained table drift from the
// validated JSON). Run this after any edit to the JSON; CI verifies via
// validate-launch-metrics.mjs --check that the two haven't drifted apart.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTable, START, END } from './lib/launch-metrics-table.mjs';

const roadmapPath = new URL('../ROADMAP.md', import.meta.url);
const data = JSON.parse(
  readFileSync(new URL('../data/launch-metrics.json', import.meta.url)),
);
const roadmap = readFileSync(roadmapPath, 'utf8');

const startIdx = roadmap.indexOf(START);
const endIdx = roadmap.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(
    `Could not find ${START} / ${END} markers in ROADMAP.md — cannot sync table.`,
  );
  process.exit(1);
}

const before = roadmap.slice(0, startIdx + START.length);
const after = roadmap.slice(endIdx);
const updated = `${before}\n\n${buildTable(data)}\n\n${after}`;

writeFileSync(roadmapPath, updated);
console.log(
  'Synced ROADMAP.md launch-metrics table from data/launch-metrics.json',
);
