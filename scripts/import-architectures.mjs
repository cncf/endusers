#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import {
  artworkMirrorPath,
  artworkPath,
  artworkUrls,
  projectAsset,
} from './lib/project-assets.mjs';
import { stripActiveContent } from './lib/svg-active-content.mjs';
import { isCncfProjectHref } from './lib/project-card-links.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const upstream = mkdtempSync(join(tmpdir(), 'cncf-architecture-'));
const source = join(upstream, 'content/en/architectures');
const recordsDir = join(root, 'data/architectures/records');
const docsDir = join(root, 'docs/architectures');
const assetsDir = join(root, 'static/img/architectures');

// Only these file types are mirrored into static/, which Docusaurus publishes
// verbatim at the site origin. Upstream controls these filenames, so anything
// the browser would execute as markup or script (.html, .xhtml, .js, .svgz)
// must never be copied: it would run in the site's own origin.
const MIRRORABLE_ASSET_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
]);

try {
  execFileSync(
    'git',
    [
      'clone',
      '--depth',
      '1',
      'https://github.com/cncf/architecture.git',
      upstream,
    ],
    { stdio: 'inherit' },
  );
  const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  rmSync(recordsDir, { recursive: true, force: true });
  rmSync(join(root, 'docs/architectures/reports'), {
    recursive: true,
    force: true,
  });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory())
      rmSync(join(docsDir, `${entry.name}.md`), { force: true });
  }
  rmSync(assetsDir, { recursive: true, force: true });
  mkdirSync(recordsDir, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });

  const records = (
    await Promise.all(
      readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => importArchitecture(entry.name, commit)),
    )
  ).sort((a, b) => a.organization.localeCompare(b.organization));

  writeFileSync(
    join(root, 'data/architectures/catalog.json'),
    JSON.stringify(records, null, 2) + '\n',
  );
  console.log(`Imported ${records.length} architectures from ${commit}`);
} finally {
  rmSync(upstream, { recursive: true, force: true });
}

async function importArchitecture(id, commit) {
  const dir = join(source, id);
  const markdown = readFileSync(join(dir, 'index.md'), 'utf8');
  const { frontmatter, body } = splitFrontmatter(markdown);
  const title = frontmatter.title ?? id;
  const organization = frontmatter.org_name ?? title.split(/[—:-]/)[0].trim();
  const industries = listValue(frontmatter.industries);
  const tags = listValue(frontmatter.tags);
  const projects = [...body.matchAll(/card header="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const sourceUrl = `https://github.com/cncf/architecture/tree/${commit}/content/en/architectures/${id}`;
  const record = {
    id,
    title,
    organization,
    summary: '',
    industries,
    tags,
    projects,
    sourceUrl,
    sourceCommit: commit,
    assets: [],
  };

  const imageDir = join(dir, 'images');
  if (!isRealDirectory(imageDir)) {
    if (lstatSync(imageDir, { throwIfNoEntry: false })) {
      console.warn(
        `Skipping images/ in ${id}: not a real directory (symlinked roots are never imported)`,
      );
    }
  } else {
    for (const file of walkFiles(imageDir)) {
      const extension = extname(file).toLowerCase();
      if (!MIRRORABLE_ASSET_EXTENSIONS.has(extension)) {
        console.warn(
          `Skipping ${relative(imageDir, file)} in ${id}: ${extension || 'no extension'} is not a mirrorable image type`,
        );
        continue;
      }
      const destination = join(assetsDir, id, relative(imageDir, file));
      mkdirSync(join(destination, '..'), { recursive: true });
      cpSync(file, destination);
    }
  }
  // Sanitization may convert raster-embedded SVGs to PNG and delete the
  // originals, so capture SVG names beforehand and rebuild the asset list
  // from disk afterward rather than trusting the copy-time list.
  const archAssetsDir = join(assetsDir, id);
  const svgsBefore = isRealDirectory(archAssetsDir)
    ? walkFiles(archAssetsDir).filter((file) => file.endsWith('.svg'))
    : [];
  sanitizeArchitectureAssets(archAssetsDir);
  record.assets = isRealDirectory(archAssetsDir)
    ? walkFiles(archAssetsDir).map(
        (file) =>
          `/img/architectures/${id}/${relative(archAssetsDir, file).replaceAll('\\', '/')}`,
      )
    : [];
  const convertedToPng = svgsBefore
    .filter(
      (file) =>
        !existsSync(file) && existsSync(file.replace(/\.svg$/i, '.png')),
    )
    .map((file) => basename(file));
  await mirrorProjectAssets(body);
  let cleanBody = cleanMarkdown(renderProjectCards(body, id), id);
  for (const svgName of convertedToPng) {
    cleanBody = cleanBody.replaceAll(
      `/img/architectures/${id}/${svgName}`,
      `/img/architectures/${id}/${svgName.replace(/\.svg$/i, '.png')}`,
    );
  }
  record.summary = firstParagraph(cleanBody);
  writeFileSync(
    join(recordsDir, `${id}.json`),
    JSON.stringify(record, null, 2) + '\n',
  );
  writeFileSync(
    join(docsDir, `${id}.md`),
    `---\ntitle: ${JSON.stringify(title)}\nsidebar_label: ${JSON.stringify(organization)}\n---\n\nimport CNCFProjectCard from '@site/src/components/CNCFProjectCard';\n\n> Imported from the [CNCF Cloud Native Reference Architecture project](${sourceUrl}). Source revision: \`${commit}\`. Documentation is distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).\n\n${cleanBody}\n`,
  );
  return record;
}

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  const frontmatter = yamlParse(text.slice(4, end)) ?? {};
  return { frontmatter, body: text.slice(end + 4).trim() };
}

function listValue(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function renderProjectCards(body, id) {
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
      const logoProp = localLogo ? ` logo=${JSON.stringify(localLogo)}` : '';
      return `<CNCFProjectCard name=${JSON.stringify(name)} href=${JSON.stringify(href)}${logoProp}${since ? ` since=${JSON.stringify(since)}` : ''}${version ? ` version=${JSON.stringify(version)}` : ''}${description ? ` description=${JSON.stringify(description)}` : ''} />`;
    },
  );
}
function cleanMarkdown(body, id) {
  return body
    .replace(/{{<[\s\S]*?>}}/g, '')
    .replace(/{{<\/?[^>]+>}}/g, '')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (_, alt, url) => {
      const asset = projectAsset(url);
      return asset ? `![${alt}](${asset})` : `[${alt}](${url})`;
    })
    .replace(/\[\[([^\]]+)\]\((https?:\/\/[^\)]+)\)\]/g, '[$1]($2)')
    .replace(
      /!\[([^\]]*)\]\((?!(?:https?:)?\/\/)(?:\.\/)?(?:images\/)?([^/][^\)]*)\)/g,
      `![$1](/img/architectures/${id}/$2)`,
    )
    .replace(/<>/g, '&lt;&gt;')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
async function mirrorProjectAssets(body) {
  for (const url of artworkUrls(body)) {
    const path = artworkPath(url);
    const relativeDestination = artworkMirrorPath(path);
    if (!relativeDestination) continue;
    const destination = join(root, relativeDestination);
    mkdirSync(join(destination, '..'), { recursive: true });
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (relativeDestination.toLowerCase().endsWith('.svg')) {
        const { source, removed } = stripActiveContent(body.toString('utf8'));
        if (removed.length) {
          console.warn(
            `Removed active content from mirrored asset ${path}: ${[
              ...new Set(removed),
            ].join(', ')}`,
          );
        }
        writeFileSync(destination, source, 'utf8');
      } else {
        writeFileSync(destination, body);
      }
    } catch {
      console.warn(`Could not mirror CNCF project asset: ${path}`);
    }
  }
}
function firstParagraph(body) {
  const paragraph = body.split(/\n\s*\n/).find((part) => {
    const text = part.trim();
    return text && !/^[#!\-[<|>]/.test(text);
  });
  return (
    paragraph?.replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 240) ?? ''
  );
}
// True only for a path that is itself a directory, never a symlink pointing at
// one. walkFiles() rejects symlinked *entries*, but a walk rooted at a
// symlinked directory descends into the link target, and every entry found
// there reports isSymbolicLink() === false — so it is mirrored as if it were
// local. The root therefore has to be checked with lstat, not existsSync,
// which follows links (see #548).
function isRealDirectory(dir) {
  return lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Upstream content is third-party input: a symlink would be copied
    // link-intact by cpSync and later written *through* by the sanitizer,
    // turning an upstream commit into an arbitrary file write. Never follow
    // or import anything that is not a regular file or directory.
    if (entry.isSymbolicLink()) {
      console.warn(`Skipping symlink ${path}: symlinks are never imported`);
      return [];
    }
    if (entry.isDirectory()) return walkFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function sanitizeArchitectureAssets(dir) {
  if (!isRealDirectory(dir)) return;
  for (const file of walkFiles(dir)) {
    if (!file.endsWith('.svg')) continue;
    const original = readFileSync(file, 'utf8');
    let source = original;

    // Upstream SVGs are third-party input and are served from the site origin,
    // so strip anything that would execute when a browser opens the file.
    const stripped = stripActiveContent(source);
    if (stripped.removed.length) {
      source = stripped.source;
      console.warn(
        `Removed active content from ${relative(join(root, 'static'), file)}: ${[
          ...new Set(stripped.removed),
        ].join(', ')}`,
      );
    }

    // Remove DOCTYPE declarations that can break XML consumers.
    source = source.replace(/<!DOCTYPE\s[^>]*>\s*/gi, '');

    // Strip draw.io/Excalidraw editable metadata to reduce bloat.
    source = source.replace(/\scontent\s*=\s*["'][^"']*["']/gi, '');

    // Add a viewBox when width and height are explicit.
    if (!/\sviewBox\s*=\s*["']/i.test(source)) {
      const widthMatch = source.match(/\swidth\s*=\s*["']([^"']+)["']/i);
      const heightMatch = source.match(/\sheight\s*=\s*["']([^"']+)["']/i);
      const width = widthMatch ? parseFloat(widthMatch[1]) : NaN;
      const height = heightMatch ? parseFloat(heightMatch[1]) : NaN;
      if (Number.isFinite(width) && Number.isFinite(height)) {
        source = source.replace(
          /<svg\b/i,
          `<svg viewBox="0 0 ${width} ${height}"`,
        );
      }
    }

    if (source !== original) {
      writeFileSync(file, source, 'utf8');
    }

    // SVGs with embedded raster data are poorly supported as image assets;
    // convert them to PNG when a renderer is available.
    if (/<image[^>]+data:image\/(jpeg|png|gif|bmp|webp)/i.test(source)) {
      const pngPath = file.replace(/\.svg$/i, '.png');
      try {
        execFileSync('rsvg-convert', ['-w', '1600', file, '-o', pngPath]);
        rmSync(file);
        console.log(
          `Converted raster-embedded SVG to PNG: ${relative(join(root, 'static'), pngPath)}`,
        );
      } catch {
        console.warn(
          `Could not convert raster-embedded SVG; consider installing rsvg-convert: ${relative(join(root, 'static'), file)}`,
        );
      }
    }
  }
}
