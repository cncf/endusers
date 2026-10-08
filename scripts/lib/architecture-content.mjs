/**
 * Markdown/frontmatter transforms shared by every architecture-page
 * producer: the cncf/architecture importer (scripts/import-architectures.mjs)
 * and the reference-architecture issue importer
 * (scripts/import-architecture-issue.mjs). Both take third-party Markdown —
 * one from an upstream git checkout, the other from a GitHub issue form — and
 * turn it into the same docs/architectures page shape, so the transform
 * itself lives in one place rather than being kept in sync by hand in two
 * scripts.
 */

import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import {
  artworkMirrorPath,
  artworkPath,
  artworkUrls,
  projectAsset,
} from './project-assets.mjs';
import {
  findRemoteReferences,
  stripActiveContent,
} from './svg-active-content.mjs';
import { isCncfProjectHref } from './project-card-links.mjs';
import { jsxElement } from './jsx-attributes.mjs';

/**
 * Splits a `---\n...\n---` YAML frontmatter block from the Markdown body that
 * follows it. Text without a leading `---` has no frontmatter at all, which
 * is valid input rather than an error: the caller falls back to deriving a
 * title/organization from the body or id.
 */
export function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  const frontmatter = yamlParse(text.slice(4, end)) ?? {};
  return { frontmatter, body: text.slice(end + 4).trim() };
}

/** Normalizes a YAML scalar-or-list frontmatter value into an array. */
export function listValue(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/**
 * Rewrites Hugo/Docsy `{{< card header="Name" >}}...{{< /card >}}` shortcodes
 * into `<CNCFProjectCard>` elements. Every attribute is passed as a JSX
 * expression rather than a quoted string: the content is third-party text,
 * and a quoted attribute gives a value containing `"` a way out of the tag.
 */
export function renderProjectCards(body, id) {
  return body.replace(
    /{{< card header="([^"]+)" >}}([\s\S]*?){{< \/card >}}/g,
    (_, name, content) => {
      const links = [...content.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map(
        (match) => match[1],
      );
      const href =
        links.find(isCncfProjectHref) ||
        `https://www.cncf.io/projects/${name.toLowerCase().replace(/\s+/g, '-')}/`;
      const logo = (content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/) ||
        [])[1];
      const since = (content.match(/\*\*Using since:\*\*\s*([^\n]+)/) ||
        [])[1]?.trim();
      const version = (content.match(/\*\*Current version:\*\*\s*([^\n]+)/) ||
        [])[1]?.trim();
      const description = content
        .replace(/!\[[^\]]*\]\([^)]*\)/, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\*\*[^*]+:\*\*[^\n]*/g, '')
        .replace(/^\s*[-*]\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
      const localLogo = logo ? projectAsset(logo) : null;
      return jsxElement('CNCFProjectCard', {
        name,
        href,
        logo: localLogo,
        since,
        version,
        description,
      });
    },
  );
}

/**
 * A Markdown link destination that carries its own authority: either an
 * absolute `scheme://host/...` or a protocol-relative `//host/...`, which
 * inherits the page's scheme and loads off-site exactly like an absolute one.
 *
 * Written as a character class rather than with the `i` flag so the rest of
 * each pattern it appears in stays case-sensitive.
 */
const REMOTE_DESTINATION = '(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\\/\\/';

/**
 * Strips remaining Hugo/Docsy shortcodes, rewrites image references to their
 * local `/img/architectures/<id>/...` or mirrored artwork path, and collapses
 * blank-line runs. `id` scopes relative image paths (`images/foo.png`) to the
 * architecture's own asset directory.
 *
 * An image whose destination names a host is demoted to a plain link unless
 * projectAsset() can resolve it to a mirrored path. A published `<img>` is
 * fetched by every visitor's browser, so leaving one pointed at a third-party
 * host beacons their IP, User-Agent and Referer there -- the hot-linking the
 * mirror exists to prevent. The test for "names a host" is
 * REMOTE_DESTINATION, not `https?://`: a protocol-relative `//host/x.png`
 * inherits the page's scheme and loads off-site just the same, and an
 * uppercase `HTTPS://` is the same URL to a browser. Both slipped past the
 * old `https?://` test, and the local-path rewrite below then either left
 * them live or mangled them into a path that cannot resolve.
 */
export function cleanMarkdown(body, id) {
  return body
    .replace(/{{<[\s\S]*?>}}/g, '')
    .replace(/{{<\/?[^>]+>}}/g, '')
    .replace(
      new RegExp(`!\\[([^\\]]*)\\]\\((${REMOTE_DESTINATION}[^\\)]+)\\)`, 'g'),
      (_, alt, url) => {
        const asset = projectAsset(url);
        return asset ? `![${alt}](${asset})` : `[${alt}](${url})`;
      },
    )
    .replace(/\[\[([^\]]+)\]\((https?:\/\/[^\)]+)\)\]/g, '[$1]($2)')
    .replace(
      new RegExp(
        `!\\[([^\\]]*)\\]\\((?!${REMOTE_DESTINATION})(?:\\.\\/)?(?:images\\/)?([^/][^\\)]*)\\)`,
        'g',
      ),
      `![$1](/img/architectures/${id}/$2)`,
    )
    .replace(/<>/g, '&lt;&gt;')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** First non-heading, non-markup paragraph, used as the catalog summary. */
export function firstParagraph(body) {
  const paragraph = body.split(/\n\s*\n/).find((part) => {
    const text = part.trim();
    return text && !/^[#!\-[<|>]/.test(text);
  });
  return (
    paragraph?.replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 240) ?? ''
  );
}

/**
 * Mirrors every cncf/artwork image referenced in `body` into
 * static/img/cncf-projects, sanitizing SVGs the same way the importer
 * sanitizes upstream images. Anything that cannot be fetched or is not a
 * cncf/artwork URL is left alone (renderProjectCards() falls back to a badge
 * when projectAsset() cannot resolve a local path).
 *
 * Callers pass in the URLs to mirror rather than a Markdown body, so a
 * caller whose input is not Markdown at all (see
 * scripts/import-architecture-issue.mjs, which reads structured project-card
 * fields rather than scanning free-form prose) can mirror exactly the URLs it
 * knows about instead of needing a Markdown body to scan with artworkUrls().
 *
 * @param {string} root Absolute path to the repository root.
 * @param {Iterable<string>} urls cncf/artwork image URLs to mirror.
 */
export async function mirrorArtworkUrls(root, urls) {
  for (const url of urls) {
    const path = artworkPath(url);
    if (!path) continue;
    const relativeDestination = artworkMirrorPath(path);
    if (!relativeDestination) continue;
    const destination = join(root, relativeDestination);
    mkdirSync(join(destination, '..'), { recursive: true });
    // writeFileSync() follows a symlink at the destination, so a link sitting
    // on a mirror path would redirect these third-party bytes to its target,
    // outside static/img/cncf-projects. Those bytes then never reach the tree
    // validate-architecture-assets.mjs scans, so the post-hoc asset gate could
    // not see what was written even in principle. Gate the write here the way
    // mirrorLandscapeLogo() does, for the same reason the remote-reference
    // check below is applied before the write rather than after it.
    const existing = lstatSync(destination, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
      console.warn(
        `Could not mirror CNCF project asset: ${path}: destination is not a regular file`,
      );
      continue;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const fetched = Buffer.from(await response.arrayBuffer());
      if (relativeDestination.toLowerCase().endsWith('.svg')) {
        const { source, removed } = stripActiveContent(
          fetched.toString('utf8'),
        );
        if (removed.length) {
          console.warn(
            `Removed active content from mirrored asset ${path}: ${[
              ...new Set(removed),
            ].join(', ')}`,
          );
        }
        // stripActiveContent() reports script-capable content, not remote
        // resource references, so an href or a CSS url() pointing at a
        // third-party host survives it untouched. A mirrored asset is
        // published from static/ at the site origin, so writing one would
        // beacon every visitor's IP, User-Agent and Referer to that host --
        // the exact hot-linking the mirror exists to prevent. Gate the write
        // the way mirrorLandscapeLogo() does, rather than relying on
        // validate-architecture-assets to catch it after the bytes are on
        // disk.
        const remote = findRemoteReferences(source);
        if (remote.length) {
          throw new Error(`remote resource references: ${remote.join('; ')}`);
        }
        writeFileSync(destination, source, 'utf8');
      } else {
        writeFileSync(destination, fetched);
      }
    } catch (error) {
      console.warn(
        `Could not mirror CNCF project asset: ${path}: ${error.message}`,
      );
    }
  }
}
