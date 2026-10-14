/**
 * Shared helpers for the collect/import scripts that pull an upstream CNCF
 * repository (cncf/landscape, cncf/architecture) into a local working
 * directory before reading it.
 *
 * Three scripts (collect-metrics.mjs, collect-enduser-members.mjs,
 * import-architectures.mjs) carried independent copies of the same two
 * `git` invocations -- a depth-1 clone, then a HEAD rev-parse to pin the
 * commit the generated output was built from -- with small drifts already
 * visible between them (differing `execFileSync` option shapes). Centralizing
 * it means the next collector only has to call these, not retype the
 * `execFileSync` plumbing.
 */

import { execFileSync } from 'node:child_process';

/**
 * Shallow-clone `url` into `destination`.
 *
 * @param {string} url - Repository URL to clone.
 * @param {string} destination - Target directory; must not already exist.
 */
export function cloneShallow(url, destination) {
  execFileSync('git', ['clone', '--depth', '1', url, destination], {
    stdio: 'inherit',
  });
}

/**
 * Return the trimmed HEAD commit sha of the repository checked out at `dir`.
 *
 * @param {string} dir - Path to a git working directory.
 * @returns {string}
 */
export function revParseHead(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}
