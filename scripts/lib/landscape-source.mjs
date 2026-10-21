/**
 * Shared read of cncf/landscape for the collectors: shallow-clone, pin and
 * validate the commit, then parse `landscape.yml`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { cloneShallow, revParseHead } from './git-source.mjs';

const LANDSCAPE_URL = 'https://github.com/cncf/landscape.git';

/**
 * Clone cncf/landscape into `destination` and read it.
 *
 * @param {string} destination - Target directory; must not already exist.
 * @returns {{revision: string, document: any}} Full commit sha and the parsed
 *   `landscape.yml`.
 */
export function readLandscape(destination) {
  cloneShallow(LANDSCAPE_URL, destination);
  const revision = revParseHead(destination);
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(
      `landscape clone returned an invalid revision: ${revision}`,
    );
  }
  const document = parse(
    readFileSync(join(destination, 'landscape.yml'), 'utf8'),
  );
  return { revision, document };
}
