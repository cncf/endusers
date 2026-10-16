/**
 * Shared helper for the collectors that pull cncf/landscape and read its
 * landscape.yml.
 *
 * collect-metrics.mjs and collect-enduser-members.mjs each cloned
 * cncf/landscape and parsed landscape.yml independently, with only one of
 * the two (collect-enduser-members.mjs) validating that the HEAD revision
 * came back as a full 40-character sha -- exactly the kind of small drift
 * git-source.mjs's own clone+rev-parse consolidation was meant to prevent
 * one layer up (see that file's doc comment). This closes the same gap for
 * the YAML read itself: one call site for "clone cncf/landscape, confirm the
 * revision, parse landscape.yml."
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { cloneShallow, revParseHead } from './git-source.mjs';

const LANDSCAPE_URL = 'https://github.com/cncf/landscape.git';

/**
 * Shallow-clone cncf/landscape into `destination`, confirm the checked-out
 * commit, and parse its landscape.yml.
 *
 * @param {string} destination - Target directory; must not already exist.
 * @returns {{document: object, revision: string}} The parsed landscape.yml
 *   and the full HEAD commit sha it was read from.
 */
export function cloneLandscape(destination) {
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
  return { document, revision };
}
