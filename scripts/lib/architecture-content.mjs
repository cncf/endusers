/**
 * Markdown transforms behind the reference-architecture issue importer
 * (scripts/import-architecture-issue.mjs), which takes third-party Markdown
 * from a GitHub issue form and turns it into a docs/architectures page. They
 * live apart from the script so the page shape is defined in one place.
 */

import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import {
  artworkMirrorPath,
  artworkPath,
  projectAsset,
} from './project-assets.mjs';
import {
  findRemoteReferences,
  stripActiveContent,
} from './svg-active-content.mjs';
import { disallowedScheme } from './uri-safety.mjs';

/**
 * A Markdown destination that carries its own authority: either an absolute
 * `scheme://host/...` or a protocol-relative `//host/...`, which inherits the
 * page's scheme and loads off-site exactly like an absolute one.
 */
const REMOTE_DESTINATION = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Any URI scheme; a scheme-less destination is a path on this site. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const markdownGrammar = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
};

function escapeLabel(text) {
  return text.replace(/[\\[\]]/g, '\\$&');
}

function destination(url) {
  return /[\s()<>]/.test(url)
    ? `<${url.replace(/[<>]/g, encodeURIComponent)}>`
    : url;
}

/**
 * Applies the image policy to every image in a parsed document.
 *
 * Images are found in the parse tree, not by pattern, so the reference style
 * (`![alt][ref]` with `[ref]: url` elsewhere), nested brackets and titles are
 * all seen as the parser sees them. Each image is replaced by exactly the
 * source range it occupies.
 *
 * - A destination whose scheme is not on the allowlist is reduced to its alt
 *   text, and that test comes first. `javascript://%0aalert(1)` names no host,
 *   but it matches REMOTE_DESTINATION exactly as `https://host/x` does, so
 *   deciding the host question first demotes it to a *link* carrying the same
 *   scheme — `//` is a JavaScript line comment, so that link runs on click.
 *   Which schemes are allowed is disallowedScheme()'s question
 *   (scripts/lib/uri-safety.mjs), the same source of truth the SVG and MDX
 *   gates ask, and it is asked here in the same order they ask it.
 * - A destination that names a host (REMOTE_DESTINATION, which includes
 *   protocol-relative and any-case schemes) is mirrored when projectAsset()
 *   resolves it and otherwise demoted to a plain link, or to its alt text
 *   inside an existing link. A published `<img>` is fetched by every visitor's
 *   browser, so a third-party host would see their IP, User-Agent and Referer.
 * - An allowed scheme that names no host (`mailto:`, `https:x`) is reduced to
 *   its alt text.
 * - A relative path is rebased onto `/img/architectures/<id>/`.
 */
function rewriteImages(body, id) {
  const tree = fromMarkdown(body, markdownGrammar);
  const definitions = new Map();
  const images = [];

  const walk = (node, inLink) => {
    // First definition of a repeated label wins, matching CommonMark and the
    // renderer (mdast-util-to-hast), so the image policy is applied to the
    // destination the page would actually have loaded rather than to a
    // duplicate the renderer discards. Kept identical to the resolution in
    // scripts/lib/mdx-active-content.mjs: the import-time rewrite and the
    // publish-time gate must not disagree about which definition a reference
    // names.
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if (node.type === 'image' || node.type === 'imageReference') {
      images.push({ node, inLink });
    }
    const nested =
      inLink || node.type === 'link' || node.type === 'linkReference';
    for (const child of node.children ?? []) walk(child, nested);
  };
  walk(tree, false);

  const edits = [];
  for (const { node, inLink } of images) {
    const url =
      node.type === 'image' ? node.url : definitions.get(node.identifier);
    const { alt } = node;
    let replacement;

    if (disallowedScheme(url)) {
      replacement = escapeLabel(alt);
    } else if (REMOTE_DESTINATION.test(url)) {
      const asset = projectAsset(url);
      if (asset) replacement = `![${escapeLabel(alt)}](${asset})`;
      else if (inLink) replacement = escapeLabel(alt);
      else replacement = `[${escapeLabel(alt)}](${destination(url)})`;
    } else if (HAS_SCHEME.test(url)) {
      replacement = escapeLabel(alt);
    } else if (url.startsWith('/')) {
      if (node.type === 'image') continue;
      replacement = `![${escapeLabel(alt)}](${destination(url)})`;
    } else {
      const rest = url.replace(/^\.\//, '').replace(/^images\//, '');
      replacement = `![${escapeLabel(alt)}](${destination(`/img/architectures/${id}/${rest}`)})`;
    }
    edits.push({
      start: node.position.start.offset,
      end: node.position.end.offset,
      replacement,
    });
  }

  let output = body;
  for (const edit of edits.sort((x, y) => y.start - x.start)) {
    output =
      output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

/**
 * Strips remaining Hugo/Docsy shortcodes, applies the image policy described
 * on {@link rewriteImages}, and collapses blank-line runs. `id` scopes
 * relative image paths (`images/foo.png`) to the architecture's own asset
 * directory.
 */
export function cleanMarkdown(body, id) {
  return rewriteImages(
    body.replace(/{{<[\s\S]*?>}}/g, '').replace(/{{<\/?[^>]+>}}/g, ''),
    id,
  )
    .replace(/\[\[([^\]]+)\]\((https?:\/\/[^)]+)\)\]/g, '[$1]($2)')
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
 * static/img/cncf-projects, sanitizing SVGs the same way the issue importer
 * sanitizes submitted images. Anything that cannot be fetched or is not a
 * cncf/artwork URL is left alone (the caller falls back to a badge when
 * projectAsset() cannot resolve a local path).
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
