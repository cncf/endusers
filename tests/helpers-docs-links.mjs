// Markdown readers shared by the docs/ contract in ./docs-contract.test.mjs
// and the unit tests for those readers in ./docs-link-helpers.test.mjs.
//
// They live here rather than inside the contract because the contract only
// ever runs them over whatever docs/ happens to contain. docs/ currently has
// no relative link carrying a `#fragment`, so `headingSlugs` never runs during
// the contract and `resolveDocPath` never takes its miss path: a regression in
// either would turn the contract green-but-vacuous instead of red. Exporting
// them lets the readers be driven directly over inputs docs/ does not supply.

import { readFileSync, statSync } from 'node:fs';

export function readDoc(file) {
  const raw = readFileSync(file, 'utf8');
  const fence = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return {
    raw,
    frontmatter: fence ? fence[1] : null,
    body: fence ? raw.slice(fence[0].length) : raw,
  };
}

// Mirrors Docusaurus' GitHub-flavoured heading slugs closely enough to catch a
// renamed or deleted heading, which is all this contract needs to detect.
export function headingSlug(text) {
  return text
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function headingSlugs(body) {
  return [...body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(([, text]) =>
    headingSlug(text),
  );
}

// Relative markdown links between docs, i.e. the ones Docusaurus resolves on
// disk. Absolute routes (/foo), external URLs and mailto: are resolved by
// `onBrokenLinks: 'throw'` at build time and are not this test's contract.
export function relativeLinks(body) {
  return [...body.matchAll(/\[(?:[^\]]*)\]\(([^)\s]+)\)/g)]
    .map(([, href]) => href)
    .filter((href) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href));
}

export function resolveDocPath(candidate) {
  for (const path of [candidate, `${candidate}.md`, `${candidate}.mdx`]) {
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      // Not a file at this extension; try the next candidate.
    }
  }
  return null;
}
