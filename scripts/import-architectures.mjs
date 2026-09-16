#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as yamlParse } from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const upstream = mkdtempSync(join(tmpdir(), 'cncf-architecture-'));
const source = join(upstream, 'content/en/architectures');
const recordsDir = join(root, 'data/architectures/records');
const docsDir = join(root, 'docs/architectures');
const assetsDir = join(root, 'static/img/architectures');

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
  if (existsSync(imageDir)) {
    for (const file of walkFiles(imageDir)) {
      const destination = join(assetsDir, id, relative(imageDir, file));
      mkdirSync(join(destination, '..'), { recursive: true });
      cpSync(file, destination);
      record.assets.push(
        `/img/architectures/${id}/${relative(imageDir, file).replaceAll('\\', '/')}`,
      );
    }
  }
  sanitizeArchitectureAssets(join(assetsDir, id));
  await mirrorProjectAssets(body);
  const cleanBody = cleanMarkdown(renderProjectCards(body, id), id);
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
        links.find((link) => link.includes('cncf.io/projects/')) ||
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
      const logoProp = logo
        ? ` logo=${JSON.stringify(projectAsset(logo))}`
        : '';
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
      return asset.startsWith('/img/')
        ? `![${alt}](${asset})`
        : `[${alt}](${url})`;
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
  for (const [, project, file] of body.matchAll(
    /https?:\/\/raw\.githubusercontent\.com\/cncf\/artwork\/main\/projects\/([^/]+)\/icon\/color\/([^/\s)]+)/g,
  )) {
    const destination = join(
      root,
      'static/img/cncf-projects',
      `${project}-${file}`,
    );
    mkdirSync(join(destination, '..'), { recursive: true });
    const url = `https://raw.githubusercontent.com/cncf/artwork/main/projects/${project}/icon/color/${file}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    } catch {
      console.warn(`Could not mirror CNCF project asset: ${project}/${file}`);
    }
  }
}
function projectAsset(url) {
  const match = url.match(/projects\/([^/]+)\/icon\/color\/([^/]+)$/);
  return match ? `/img/cncf-projects/${match[1]}-${match[2]}` : url;
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
function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walkFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

function sanitizeArchitectureAssets(dir) {
  if (!existsSync(dir)) return;
  for (const file of walkFiles(dir)) {
    if (!file.endsWith('.svg')) continue;
    const original = readFileSync(file, 'utf8');
    let source = original;

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
