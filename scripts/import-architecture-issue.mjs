#!/usr/bin/env node
/**
 * Turns a reference-architecture submission issue (opened with
 * .github/ISSUE_TEMPLATE/reference-architecture.yml) into a
 * docs/architectures/<id>/index.md page whose front matter carries the
 * catalog metadata, then regenerates data/architectures/catalog.json from
 * every page's front matter.
 *
 * Run by .github/workflows/architecture-submission.yml when a maintainer adds
 * the `architecture-ready` label to a submission issue. The workflow points
 * --issue-json at $GITHUB_EVENT_PATH, whose `issue` field is exactly the
 * REST API issue object GitHub passes to an `issues: labeled` event; a bare
 * issue object (no wrapping `issue` field) also works, which is what the test
 * suite and any manual `--issue-json` invocation pass directly.
 *
 * The section labels parsed out of the issue body below must match the
 * `label:` text of every field in the issue template exactly — GitHub renders
 * each form field as a `### <label>` heading followed by the response, and
 * that heading text is the only link between the two files.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { jsxElement } from './lib/jsx-attributes.mjs';
import { artworkPath, projectAsset } from './lib/project-assets.mjs';
import { escapeMdx, unescapeMdx } from './lib/mdx-escape.mjs';
import {
  cleanMarkdown,
  firstParagraph,
  mirrorArtworkUrls,
} from './lib/architecture-content.mjs';
import {
  FRONT_MATTER_KEY,
  collectArchitectureRecords,
  serializeCatalog,
} from './lib/architecture-frontmatter.mjs';
import { REPO_AUTHORED_PAGES } from './lib/architecture-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docsDir = join(root, 'docs/architectures');
const catalogPath = join(root, 'data/architectures/catalog.json');

const TITLE_PREFIX = /^\[Reference Architecture\]:\s*/i;

// Body sections in generated-page order. `required: true` sections must have
// a non-empty issue-form response; the rest are rendered only when answered.
const BODY_SECTIONS = [
  { label: 'Describe your organisation', required: true },
  { label: 'Describe your entity and/or team' },
  {
    label:
      'Brief overview of your architecture and any potential goals you are trying to achieve with it?',
    required: true,
  },
  { label: 'Can you expand on why you are using those projects/services?' },
  { label: 'What has worked well?' },
  { label: 'What has not worked well?' },
  {
    label:
      'What sort of "glue" have you had to develop to enable usage of your architecture?',
  },
  {
    label:
      'Has your architecture evolved? What lessons did you learn from previous iterations?',
  },
  {
    label:
      "What's next for your architecture? What are you looking to do next?",
  },
];

async function main() {
  const issueJsonPath =
    readArg('--issue-json') ?? process.env.GITHUB_EVENT_PATH;
  if (!issueJsonPath) {
    throw new Error(
      'No issue JSON to read: pass --issue-json <path> or set GITHUB_EVENT_PATH',
    );
  }
  const event = JSON.parse(readFileSync(issueJsonPath, 'utf8'));
  const issue = event.issue ?? event;
  if (!issue?.number || typeof issue.body !== 'string') {
    throw new Error(
      `${issueJsonPath} does not look like an issue payload (missing number/body)`,
    );
  }

  const fields = parseIssueForm(issue.body);
  const title = String(issue.title ?? '')
    .replace(TITLE_PREFIX, '')
    .trim();
  const orgName = field(fields, 'Organization or Team Name');
  if (!title || !orgName) {
    throw new Error(
      'Missing required issue title or "Organization or Team Name" field',
    );
  }

  // Issue-sourced records take their catalog dates from the issue itself:
  // published when it was opened, updated when it was last edited.
  const published = utcDate(issue.created_at);
  if (!published) {
    throw new Error('Issue payload is missing a valid created_at timestamp');
  }
  const updated = utcDate(issue.updated_at) ?? published;

  const id = uniqueId(slugify(orgName), issue.number);
  const sourceUrl =
    issue.html_url ?? `https://github.com/cncf/endusers/issues/${issue.number}`;

  const industries = splitList(field(fields, 'Industries'));
  // Tags are shown as search chips, so they are stored as readable words.
  const tags = splitList(field(fields, 'Tags')).map((tag) =>
    tag.replaceAll('_', ' '),
  );
  const projects = parseProjects(field(fields, 'Relevant CNCF Projects'));

  await mirrorArtworkUrls(
    root,
    projects.map((project) => project.logo).filter(Boolean),
  );

  const sections = [renderProjectsSection(projects)];
  for (const { label, required } of BODY_SECTIONS) {
    const value = fields.get(label);
    if (required && !value) {
      throw new Error(`Issue body is missing a response for "${label}"`);
    }
    if (!value) continue;
    sections.push(renderSection(label, value));
  }

  const cleanBody = cleanMarkdown(sections.filter(Boolean).join('\n\n'));

  // The page's front matter is the catalog record's source of truth; the
  // summary is rendered as a plain text node, where the character references
  // renderSection() added would show through literally, so it is taken from
  // the author's own characters. `id` and `assets` are derived from the
  // directory when the catalog is generated.
  const frontMatter = stringify(
    {
      title,
      sidebar_label: orgName,
      [FRONT_MATTER_KEY]: {
        organization: orgName,
        summary: firstParagraph(unescapeMdx(cleanBody)),
        industries,
        tags,
        projects: projects.map((project) => project.name),
        sourceUrl,
        sourceIssue: issue.number,
        published,
        updated,
      },
    },
    { lineWidth: 0 },
  ).trimEnd();

  mkdirSync(join(docsDir, id), { recursive: true });
  writeFileSync(
    join(docsDir, id, 'index.md'),
    `---\n${frontMatter}\n---\n\nimport CNCFProjectCard from '@site/src/components/CNCFProjectCard';\n\n> Submitted by the community via [reference architecture issue #${issue.number}](${sourceUrl}). Documentation is distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).\n\n${cleanBody}\n`,
  );

  // Regenerate the catalog from every page so the new record lands in the
  // same order and shape `npm run generate:architectures` would produce.
  const { records, problems } = collectArchitectureRecords(
    docsDir,
    REPO_AUTHORED_PAGES,
  );
  if (problems.length > 0)
    throw new Error(
      `Cannot regenerate the catalog: ${problems
        .map(({ page, message }) => `${page}: ${message}`)
        .join('; ')}`,
    );
  writeFileSync(catalogPath, serializeCatalog(records));

  console.log(
    `Imported reference architecture "${id}" from issue #${issue.number}`,
  );
  // Lets the calling workflow step reference the generated id (for the pull
  // request title) without having to guess it from the filesystem.
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `id=${id}\n`);
  }
}

function utcDate(timestamp) {
  const parsed = new Date(timestamp ?? '');
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Splits a GitHub issue-form body into a Map of field label to response,
 * from the `### <label>\n\n<value>` blocks GitHub renders for every form
 * field. An unanswered optional field renders its value as the literal text
 * `_No response_`, which is normalized to an empty string here.
 */
function parseIssueForm(body) {
  const fields = new Map();
  const blocks = body.split(/^### /m).slice(1);
  for (const block of blocks) {
    const newline = block.indexOf('\n');
    if (newline === -1) continue;
    const label = block.slice(0, newline).trim();
    const value = block.slice(newline + 1).trim();
    fields.set(label, value === '_No response_' ? '' : value);
  }
  return fields;
}

function field(fields, label) {
  const value = fields.get(label);
  if (value === undefined) {
    throw new Error(`Issue body is missing the "${label}" field`);
  }
  return value;
}

function splitList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Route-segment/filesystem-path-safe slug; mirrors the id pattern
// scripts/validate-architectures.mjs enforces.
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Disambiguates a second submission that slugifies to the same id as an
// existing architecture directory, rather than clobbering its page.
function uniqueId(base, issueNumber) {
  if (!base) return `issue-${issueNumber}`;
  return existsSync(join(docsDir, base)) ? `${base}-${issueNumber}` : base;
}

/**
 * Parses the "Relevant CNCF Projects" field, one project per line in the form
 * `Name | Logo URL | Using since | Current version | Description`. Trailing
 * columns may be omitted; only Name is required.
 */
function parseProjects(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [name, logo, since, version, description] = line
        .split('|')
        .map((part) => part.trim());
      return { name, logo: logo || null, since, version, description };
    })
    .filter((project) => project.name);
}

function renderProjectsSection(projects) {
  if (!projects.length) return '';
  const cards = projects
    .map((project) => {
      // The issue table carries no link field, so there is no verified href:
      // a slug derived from the name is a guess that 404s for any project
      // without a cncf.io page, and the card renders without a link (#1448).
      const logo =
        project.logo && artworkPath(project.logo)
          ? projectAsset(project.logo)
          : null;
      return jsxElement('CNCFProjectCard', {
        name: project.name,
        logo,
        since: project.since || undefined,
        version: project.version || undefined,
        description: project.description || undefined,
      });
    })
    .join('\n\n');
  return `## Relevant CNCF projects\n\n${cards}`;
}

/**
 * Renders one answer as a `## <heading>` section.
 *
 * The heading comes from the hardcoded BODY_SECTIONS list, but the value is
 * whatever a submitter typed into the issue form, and the generated page is
 * compiled as MDX. It is escaped here rather than in cleanMarkdown(): the
 * sections are joined with the generated `<CNCFProjectCard />` markup from
 * renderProjectsSection() before that shared helper runs, and escaping the
 * joined text would destroy the cards.
 */
function renderSection(heading, value) {
  return `## ${heading}\n\n${escapeMdx(value)}`;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
