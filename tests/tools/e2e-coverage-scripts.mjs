import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Scripts captured by a run are copied here so the published artifact carries
// its own inputs. Without them the report can only be rendered against the
// exact build/ that produced it, and that build does not reproduce outside the
// runner -- which makes the number behind the merge gate unauditable.
export const COVERAGE_SCRIPTS_DIR = 'scripts';

const ELIGIBLE_SCRIPT = /(?:\.m?js$|\/assets\/js\/)/u;
const SOURCE_MAPPING_URL = /(?:\/\/[#@]\s*sourceMappingURL=)(\S+)/u;
const DATA_URL = /^data:/u;

export function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

export function isEligibleScript(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ELIGIBLE_SCRIPT.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

// decodeURIComponent throws URIError on a literal `%` not followed by two
// hex digits -- a sequence the URL parser accepts and preserves verbatim
// (e.g. /assets/js/100%.js). The decode only normalises encoded names back
// to their on-disk spelling; when the text was never encoded, the raw text
// is that spelling, so the total form falls back to it instead of crashing
// the seal step or the reporter. Nothing security-relevant depends on the
// decode succeeding: every caller re-checks containment after
// resolve/realpath on whichever form is returned.
export function totalDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// The leading slash is stripped so the pathname can be joined onto a root. The
// result is still attacker-controlled -- every caller re-checks containment
// after resolving it.
export function scriptPathname(url) {
  const parsed = new URL(url);
  return totalDecodeURIComponent(parsed.pathname).replace(/^\/+/u, '');
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// Resolves a captured script's pathname inside one root, rejecting anything
// that escapes it. Returns null when the file is simply absent from this root
// so the caller can try the next one. An escape attempt throws under `strict`
// and returns null otherwise: the reporter is the single place that rejects a
// malicious URL, so capture only has to decline to copy it.
export async function resolveScriptInRoot(
  root,
  pathname,
  url,
  { strict = true } = {},
) {
  const escaped = () => {
    if (strict) {
      throw new Error(`coverage script escapes build directory: ${url}`);
    }
    return null;
  };
  let rootPath;
  try {
    rootPath = await realpath(root);
  } catch {
    return null;
  }
  const candidate = resolve(root, pathname);
  if (!isInside(resolve(root), candidate)) return escaped();
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    return null;
  }
  if (!isInside(rootPath, resolved)) return escaped();
  return { root: rootPath, path: resolved };
}

async function copyInto(targetRoot, relativePath, sourcePath) {
  // `relativePath` is always derived from a realpath already proved to sit
  // inside the build root, so no further containment guard is reachable here.
  const destination = resolve(targetRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  // Copy through a temporary name so a crashed seal can never leave a
  // half-written script that later passes the sha256 check by accident.
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await copyFile(sourcePath, temporary);
  await rename(temporary, destination);
  return destination;
}

function sourceMapReference(source) {
  const match = SOURCE_MAPPING_URL.exec(source);
  return match ? match[1] : null;
}

// A script is only copied together with the source map it names. Copying the
// script alone would shadow a usable build/ copy with one the reporter cannot
// map, so a script whose map is missing is left out entirely and the reporter
// falls back to build/.
async function captureScript(buildRoot, targetRoot, pathname, url) {
  const script = await resolveScriptInRoot(buildRoot, pathname, url, {
    strict: false,
  });
  if (!script) return null;

  const source = await readFile(script.path, 'utf8');
  const reference = sourceMapReference(source);
  let mapRelative = null;
  if (reference && !DATA_URL.test(reference)) {
    const mapPath = resolve(dirname(script.path), reference);
    if (!isInside(script.root, mapPath)) return null;
    let resolvedMapPath;
    try {
      resolvedMapPath = await realpath(mapPath);
    } catch {
      return null;
    }
    if (!isInside(script.root, resolvedMapPath)) return null;
    mapRelative = relative(script.root, resolvedMapPath).split(sep).join('/');
    await copyInto(targetRoot, mapRelative, resolvedMapPath);
  }

  const scriptRelative = relative(script.root, script.path)
    .split(sep)
    .join('/');
  await copyInto(targetRoot, scriptRelative, script.path);
  return { script: scriptRelative, map: mapRelative };
}

/**
 * Copies every build script a sealed run references into the run directory so
 * the published artifact can be rendered without the build that produced it.
 *
 * Best effort by design: a script that cannot be copied is reported in
 * `missing` and left to the reporter, which still fails closed when it cannot
 * resolve the script from any root.
 *
 * @param {string} runDir - Coverage run directory holding the capture payloads
 * @param {object} options
 * @param {string} options.buildDir - Build directory the scripts were served from
 * @param {string} options.artifactKind - `kind` marking a capture payload
 * @returns {Promise<{copied: string[], missing: string[]}>}
 */
export async function captureRunScripts(runDir, { buildDir, artifactKind }) {
  if (!(await directoryExists(buildDir))) return { copied: [], missing: [] };

  const wanted = new Map();
  for (const entry of await readdir(runDir)) {
    if (!entry.endsWith('.json') || entry === 'manifest.json') continue;
    let payload;
    try {
      payload = JSON.parse(await readFile(join(runDir, entry), 'utf8'));
    } catch {
      continue;
    }
    if (payload?.kind !== artifactKind) continue;
    for (const scriptCoverage of payload.result ?? []) {
      // A payload that already inlines its source needs nothing on disk.
      if (scriptCoverage?.source !== undefined) continue;
      if (!isEligibleScript(scriptCoverage?.url)) continue;
      wanted.set(scriptPathname(scriptCoverage.url), scriptCoverage.url);
    }
  }

  const targetRoot = join(runDir, COVERAGE_SCRIPTS_DIR);
  const copied = [];
  const missing = [];
  for (const [pathname, url] of wanted) {
    const result = await captureScript(buildDir, targetRoot, pathname, url);
    if (!result) {
      missing.push(pathname);
      continue;
    }
    copied.push(result.script);
    if (result.map) copied.push(result.map);
  }
  return { copied: copied.sort(), missing: missing.sort() };
}
