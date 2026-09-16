#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectError, reportAndExit } from './lib/validate-utils.mjs';

const root = new URL('..', import.meta.url).pathname;
const assetsDir = join(root, 'static/img/architectures');
const shouldFix = process.argv.includes('--fix');

const issues = [];
const fixed = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function record(path, severity, message) {
  const rel = relative(root, path);
  collectError(issues, rel, severity, message);
}

function validateSvg(path) {
  const original = readFileSync(path, 'utf8');
  let source = original;
  const rel = relative(root, path);

  // Critical: SVG must declare the SVG namespace.
  if (!/\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(source)) {
    record(path, 'error', 'missing xmlns="http://www.w3.org/2000/svg"');
  }

  // Critical: DOCTYPE is unnecessary in SVG images and can break XML parsers.
  if (/<!DOCTYPE\s/i.test(source)) {
    if (shouldFix) {
      source = source.replace(/<!DOCTYPE\s[^>]*>\s*/i, '');
      fixed.push(`${rel}: removed DOCTYPE`);
    } else {
      record(path, 'error', 'contains a DOCTYPE declaration');
    }
  }

  // Critical: viewBox is required for responsive rendering at all sizes.
  // Auto-fix when explicit width/height dimensions are present.
  if (!/\sviewBox\s*=\s*["']/.test(source)) {
    const widthMatch = source.match(/\swidth\s*=\s*["']([^"']+)["']/);
    const heightMatch = source.match(/\sheight\s*=\s*["']([^"']+)["']/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : NaN;
    const height = heightMatch ? parseFloat(heightMatch[1]) : NaN;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      if (shouldFix) {
        source = source.replace(
          /<svg\b/i,
          `<svg viewBox="0 0 ${width} ${height}"`,
        );
        fixed.push(`${rel}: added viewBox="0 0 ${width} ${height}"`);
      } else {
        record(
          path,
          'error',
          `missing viewBox attribute (has width=${width}, height=${height})`,
        );
      }
    } else {
      record(
        path,
        'error',
        'missing viewBox attribute and resolvable width/height',
      );
    }
  }

  // Critical: embedded raster data bloats SVGs and defeats the format's purpose.
  if (/data:image\/(jpeg|png|gif|bmp|webp)/i.test(source)) {
    record(path, 'error', 'contains embedded raster image data');
  }

  // Warning: draw.io/Excalidraw metadata bloats files and may confuse optimizers.
  if (/\scontent\s*=\s*["']&lt;mxfile/i.test(source)) {
    if (shouldFix) {
      source = source.replace(/\scontent\s*=\s*["'][^"']*["']/i, '');
      fixed.push(`${rel}: stripped draw.io mxfile metadata`);
    } else {
      record(
        path,
        'warn',
        'contains draw.io mxfile metadata in content attribute',
      );
    }
  }

  // Warning: foreignObject is not supported by all SVG renderers and can fall back poorly.
  if (/<foreignObject\b/i.test(source)) {
    record(
      path,
      'warn',
      'contains foreignObject (ensure a text fallback is present)',
    );
  }

  if (shouldFix && source !== original) {
    writeFileSync(path, source, 'utf8');
  }
}

function validateAsset(path) {
  const rel = relative(root, path);
  const stats = statSync(path);
  const maxSize = 2 * 1024 * 1024; // 2 MB
  if (stats.size > maxSize) {
    record(
      path,
      'warn',
      `asset is ${(stats.size / 1024 / 1024).toFixed(2)} MB (consider optimization)`,
    );
  }

  if (path.endsWith('.svg')) {
    validateSvg(path);
  }
}

const assets = exists(assetsDir) ? walk(assetsDir) : [];
for (const asset of assets) {
  validateAsset(asset);
}

if (fixed.length) {
  console.log(`Fixed ${fixed.length} issue(s):`);
  for (const message of fixed) console.log(`  - ${message}`);
}

reportAndExit(issues, 'architecture assets');

// Reached only when there are no errors (warnings do not abort).
console.log(`Validated ${assets.length} architecture asset(s).`);
if (shouldFix && issues.length === 0) {
  console.log('No fixes were needed.');
}

function exists(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
